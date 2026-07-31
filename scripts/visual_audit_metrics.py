"""Pure metric helpers shared by the visual audit and its regression tests."""


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
