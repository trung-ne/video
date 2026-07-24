# /validate — Schema và semantic quality

```powershell
npm run validate -- projects/<id>/timeline.json
npm run quality -- projects/<id>/timeline.json
npm run check
```

Schema v2 bắt buộc `sourceRange`, `visualRegister`, `semanticTakeaway`,
`semanticAssetIds` và không có `unresolvedAssets`. Không tự sửa source range hoặc
semantic asset để làm gate pass.
