QuanLyRemote v1.0.0 — ứng dụng Windows cho SSH, SFTP và Remote Desktop.

- Giao diện tối/sáng, Tiếng Việt/English, nhóm/nhãn/yêu thích/tìm kiếm.
- SSH nhiều tab, xác thực mật khẩu/khóa/agent, xác minh khóa máy chủ.
- SFTP hai cột, upload/download, tiến độ/hủy, tạo thư mục/đổi tên/xóa.
- RDP mở qua Windows Remote Desktop.
- Lệnh đã lưu, command palette, phím tắt, sao lưu cấu hình không chứa mật khẩu.
- Mật khẩu tùy chọn mã hóa bằng Windows DPAPI.

Tải `setup.exe` để cài, hoặc `portable.exe` để chạy trực tiếp. Windows 10/11 x64;
không cần cài Node.js. Đối chiếu SHA-256 trong SHA256SUMS.txt. Bản đầu chưa ký số.

Đã chạy 20 kiểm thử unit/integration SSH/SFTP và kiểm thử UI trên ứng dụng desktop
cùng bản đóng gói. Kiểm thử dùng máy chủ localhost; chưa kiểm tra server riêng của bạn.

Phiên bản này chưa có jump host/tunnel, split pane, FTP/VNC, AI agent hay cloud sync.
Xem README và docs/USER_GUIDE.md để bắt đầu.
