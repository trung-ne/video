# Claude Code qua ChatGPT Plus/Codex

Hướng dẫn này dùng Claude Code làm coding harness, nhưng route model qua
`raine/claude-code-proxy` và tài khoản ChatGPT Plus/Codex. Không cần
`OPENAI_API_KEY`; usage dùng quota Codex của gói ChatGPT.

## Kiến trúc

```text
Claude Code -> local proxy (127.0.0.1:18765) -> ChatGPT Codex OAuth
```

Model slot được map như sau:

| Claude Code UI | Backend thực tế |
| --- | --- |
| Opus | GPT-5.6 Sol |
| Sonnet | GPT-5.6 Terra |
| Haiku | GPT-5.6 Luna |

Trong picker `/model`, Claude Code vẫn hiện các tên slot Opus/Sonnet/Haiku.
Vì vậy chọn **Sonnet** nghĩa là chọn Terra, không phải model Claude.

## Cài trên Windows

1. Cài [Claude Code](https://docs.anthropic.com/en/docs/claude-code) và xác nhận
   `claude --version` hoạt động.
2. Tải Windows `amd64` ZIP mới nhất từ
   [Claude Code Proxy releases](https://github.com/raine/claude-code-proxy/releases).
   Giải nén `claude-code-proxy.exe` vào:

   ```powershell
   $installDir = "$env:USERPROFILE\.local\bin"
   New-Item -ItemType Directory -Force -Path $installDir
   # Copy file claude-code-proxy.exe đã giải nén vào $installDir
   ```

3. Thêm thư mục đó vào PATH người dùng và terminal hiện tại:

   ```powershell
   $installDir = "$env:USERPROFILE\.local\bin"
   $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
   if (($userPath -split ';') -notcontains $installDir) {
     [Environment]::SetEnvironmentVariable('Path', "$userPath;$installDir", 'User')
   }
   $env:Path += ";$installDir"
   claude-code-proxy --version
   ```

   Nếu PowerShell vẫn không nhận lệnh, dùng đường dẫn tuyệt đối:

   ```powershell
   & "$env:USERPROFILE\.local\bin\claude-code-proxy.exe" --version
   ```

## Đăng nhập ChatGPT Plus/Codex

1. Trong ChatGPT mở **Settings → Security** và bật **Device Code Authentication
   for Codex**.
2. Chạy:

   ```powershell
   claude-code-proxy codex auth device
   ```

3. Mở URL được in ra (`https://auth.openai.com/codex/device`), nhập mã thiết bị,
   rồi hoàn tất đăng nhập tài khoản ChatGPT Plus.
4. Kiểm tra:

   ```powershell
   claude-code-proxy codex auth status
   ```

Credential được proxy lưu local dưới thư mục cấu hình của người dùng. Không copy
file credential, không commit vào Git, và không đưa vào project `.env`.

## Dùng trong một project

Copy [`scripts/start-claude-plus.ps1`](../scripts/start-claude-plus.ps1) vào
project cần dùng (giữ nguyên nội dung), rồi chạy tại root project:

```powershell
.\scripts\start-claude-plus.ps1
```

Launcher sẽ:

- khởi động proxy nếu cổng `127.0.0.1:18765` chưa lắng nghe;
- route Opus/Sonnet/Haiku đến Sol/Terra/Luna;
- route subagent đến Sol;
- chỉ đặt biến môi trường cho phiên Claude Code đó.

Chạy một prompt không tương tác:

```powershell
.\scripts\start-claude-plus.ps1 -p "Kiểm tra cấu trúc repo này"
```

Sau khi clone sang project khác, chỉ cần copy launcher; proxy installation và OAuth
là cấu hình theo máy, không phải theo repo.

## Model, reasoning và thinking

Trong Claude Code:

```text
/model
/effort high
```

Mức effort có thể dùng là `low`, `medium`, `high`, `xhigh`, và `max`.
Khuyến nghị:

| Việc | Model slot | Effort |
| --- | --- | --- |
| Việc nhanh, tra cứu file | Haiku/Luna | low hoặc medium |
| Sửa feature thông thường | Sonnet/Terra | high |
| Debug/refactor khó | Opus/Sol | high hoặc xhigh |
| Bài toán rất khó | Opus/Sol | max |

Effort cao hơn có thể dùng nhiều quota Codex và chậm hơn. Phần thinking/reasoning
hiển thị trong terminal chỉ là presentation khi backend/proxy hỗ trợ; không dùng
nó làm bằng chứng rằng effort backend đã đổi. Xác nhận bằng `/effort` và kết quả
thực tế của task.

## Xử lý lỗi thường gặp

| Triệu chứng | Cách xử lý |
| --- | --- |
| `claude-code-proxy` is not recognized | Thêm `$env:Path += ";$env:USERPROFILE\.local\bin"` hoặc gọi bằng đường dẫn tuyệt đối. |
| `Failed to bind to port 1455` khi auth device | Một phiên device login cũ đang chạy; dùng URL/mã của phiên đó hoặc đóng nó rồi chạy lại. |
| Không thấy Terra trong `/model` | Chọn **Sonnet**: launcher map Sonnet sang GPT-5.6 Terra. Đóng session và mở lại launcher sau khi cập nhật script. |
| Proxy không chạy | Kiểm tra `Get-NetTCPConnection -LocalPort 18765 -State Listen`; sau đó chạy `claude-code-proxy serve`. |
| OAuth hết hạn | Chạy lại `claude-code-proxy codex auth device`. |
| Hết quota | Chờ quota Codex reset hoặc đổi sang effort/model thấp hơn. |

## Bảo mật và cập nhật

- Proxy chỉ nên bind loopback (`127.0.0.1`); không expose port proxy ra LAN/Internet.
- Cập nhật proxy bằng cách tải release mới, thay executable và kiểm tra lại
  `claude-code-proxy --version`.
- Sau mỗi cập nhật, smoke test bằng:

  ```powershell
  .\scripts\start-claude-plus.ps1 -p "Reply exactly: proxy-ok"
  ```

Tài liệu upstream: [raine/claude-code-proxy](https://github.com/raine/claude-code-proxy).
