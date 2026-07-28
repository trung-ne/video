---
description: Chạy schema gate + thẻ điểm đạo diễn V4/V5 trên timeline của project
argument-hint: <project-id> hoặc <path-to-timeline.json>
---

# /validate — Schema và semantic quality

```powershell
npm run validate -- projects/<id>/timeline.json
npm run quality -- projects/<id>/timeline.json
npm run check
```

`quality` còn kiểm timing provenance và canonical hash của storyboard,
`durations.json` và `words.json`; grade A không thể bù cho timing không đáng tin.

Schema v2 bắt buộc `sourceRange`, `visualRegister`, `semanticTakeaway`,
`semanticAssetIds` và không có `unresolvedAssets`. Không tự sửa source range hoặc
semantic asset để làm gate pass.
