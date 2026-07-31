"""Pure metric helpers shared by the visual audit and its regression tests."""


def scene_at(timeline, video_seconds, timeline_offset_seconds=0.0):
    """Map a local video timestamp to its source timeline scene.

    Partial `--frames` renders start at a non-zero timeline frame but their
    encoded timestamps restart at zero. Keeping the offset explicit prevents
    slice audits from borrowing register and occupancy targets from scene 1.
    """
    if not timeline:
        return None
    timeline_seconds = video_seconds + timeline_offset_seconds
    frame = timeline_seconds * timeline.get("fps", 30)
    for scene in timeline.get("scenes", []):
        start = scene.get("startFrame", 0)
        if start <= frame < start + scene.get("durationFrames", 0):
            return scene.get("id")
    return None


def focal_footprint(np, pixels):
    """Longest-side footprint of the largest painted component."""
    quantized = (pixels // 24).astype(np.uint8).reshape(-1, 3)
    colors, counts = np.unique(quantized, axis=0, return_counts=True)
    background = colors[counts.argmax()].astype(np.float32) * 24 + 12
    color_distance = np.linalg.norm(pixels - background, axis=2)
    mask = color_distance > 42
    height, width = mask.shape
    seen = np.zeros_like(mask, dtype=bool)
    best_size = 0
    best_footprint = 0.0
    minimum_component = max(4, round(width * height * 0.0015))
    for y in range(height):
        for x in range(width):
            if not mask[y, x] or seen[y, x]:
                continue
            stack = [(y, x)]
            seen[y, x] = True
            size = 0
            min_y = max_y = y
            min_x = max_x = x
            while stack:
                cy, cx = stack.pop()
                size += 1
                min_y, max_y = min(min_y, cy), max(max_y, cy)
                min_x, max_x = min(min_x, cx), max(max_x, cx)
                for ny, nx in ((cy - 1, cx), (cy + 1, cx), (cy, cx - 1), (cy, cx + 1)):
                    if 0 <= ny < height and 0 <= nx < width and mask[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True
                        stack.append((ny, nx))
            if size >= minimum_component and size > best_size:
                best_size = size
                best_footprint = max(
                    (max_x - min_x + 1) / width,
                    (max_y - min_y + 1) / height,
                )
    return best_footprint


def duplicate_metrics(rows, differences, threshold, sample_seconds):
    duplicate_flags = [difference < threshold for difference in differences]
    within_scene_pairs = [
        rows[index].get("sceneId") is not None
        and rows[index].get("sceneId") == rows[index + 1].get("sceneId")
        for index in range(len(rows) - 1)
    ]
    cross_scene_pairs = [not value for value in within_scene_pairs]
    within_duplicates = [
        duplicate for duplicate, within in zip(duplicate_flags, within_scene_pairs)
        if within
    ]
    cross_duplicates = [
        duplicate for duplicate, cross in zip(duplicate_flags, cross_scene_pairs)
        if cross
    ]

    longest_global = 0
    current_global = 0
    longest_within = 0
    current_within = 0
    for duplicate, within in zip(duplicate_flags, within_scene_pairs):
        current_global = current_global + 1 if duplicate else 0
        longest_global = max(longest_global, current_global)
        current_within = current_within + 1 if duplicate and within else 0
        longest_within = max(longest_within, current_within)

    ratio = lambda values: sum(values) / len(values) if values else 0.0
    return {
        "duplicateFlags": duplicate_flags,
        "nearDuplicateRatio": ratio(duplicate_flags),
        "withinSceneNearDuplicateRatio": ratio(within_duplicates),
        "crossSceneNearDuplicateRatio": ratio(cross_duplicates),
        "withinScenePairCount": len(within_duplicates),
        "withinSceneDuplicateCount": sum(within_duplicates),
        "crossScenePairCount": len(cross_duplicates),
        "crossSceneDuplicateCount": sum(cross_duplicates),
        "longestNearDuplicateRunSeconds": longest_global * sample_seconds,
        "longestWithinSceneNearDuplicateRunSeconds": longest_within * sample_seconds,
    }
