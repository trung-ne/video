---
description: Mở Remotion Studio xem trước một project (không copy timeline về root)
argument-hint: <project-id-or-path>
---

# /preview — Preview một project

```powershell
npm run preview:project -- --project <id-or-path>
```

Không copy timeline về root và không sửa `src/Root.tsx`. Script compile đúng
SceneTimeline của project và truyền props tạm cho Remotion Studio.
