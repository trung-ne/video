# Archived scripts

Script một lần / thử nghiệm, **không nằm trong pipeline** (không skill nào và package.json nào gọi). Giữ lại để tham khảo, có thể xoá hẳn khi chắc chắn không cần.

| File | Vì sao archive |
|------|----------------|
| `create-assets.ps1`, `download-assets.ps1`, `download-svgs.ps1`, `fetch-assets.ps1` | 4 script tải SVG asset trùng chức năng, thử nghiệm. Bộ asset chuẩn sẽ được thay mới. |
| `generate-cat-poses.cjs` | Sinh pose mèo một lần. |
| `patch-timeline-v2.cjs` | Patch timeline một lần cho lần migrate cũ. |

Pipeline production hiện hành là Route A: `build-storyboard.ts`, measured TTS/alignment,
`compile-storyboard.ts`, semantic chunk checkpoints cho video dài, rồi `render.ts`.
`generate-timeline.ts` chỉ là fail-closed Route B tombstone.
