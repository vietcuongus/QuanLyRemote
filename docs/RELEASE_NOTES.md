QuanLyRemote v1.0.2 — lưu và khôi phục phiên làm việc.

- Tự nhớ tab SSH/SFTP, thứ tự tab, chế độ Terminal/File SFTP và tab đang chọn.
- Mở tool lại sẽ khôi phục tab và tự kết nối bằng mật khẩu/khóa đã lưu hoặc SSH agent.
- Phiên chưa lưu mật khẩu có tab chờ nhập; máy offline không chặn các phiên khác.
- Đóng cả tool giữ danh sách phiên; đóng riêng một tab bằng X loại tab đó khỏi lần khôi phục sau.
- Có tùy chọn bật/tắt Khôi phục phiên khi mở ứng dụng trong Cài đặt, mặc định bật.
- Giữ bản sửa copy/paste của 1.0.1 và dữ liệu kết nối/mật khẩu đã lưu từ bản cũ.

Đóng tool cũ rồi chạy setup để cài đè trên cùng tài khoản Windows; portable thì chạy file mới.
Các bản trước 1.0.2 chưa lưu tab: mở các tab cần làm việc một lần sau cập nhật để tool ghi nhớ.
Khôi phục tạo kết nối SSH mới, không tự chạy lại lệnh hoặc tiếp tục truyền file.
Dùng tmux/screen nếu cần giữ chương trình trên server. RDP chạy trong cửa sổ Windows riêng.

Đã kiểm thử SSH/SFTP, nhiều lần đóng/mở lại UI và bản đóng gói, cùng nâng cấp dữ liệu cũ.
Windows 10/11 x64. Bản chưa ký số; SHA256SUMS.txt đi kèm release.
