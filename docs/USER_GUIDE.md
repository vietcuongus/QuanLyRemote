# Hướng dẫn QuanLyRemote

## Tổ chức máy chủ

Nhóm là tên tự do trong biểu mẫu. Dùng Production / Development / Personal hoặc
tên khách hàng/dự án. Sidebar tự tạo nhóm từ những kết nối đã lưu. Nhãn phân cách
bằng dấu phẩy. Tìm kiếm nhận tên, IP, user, nhóm và nhãn.

Nhấn ngôi sao để thêm vào Yêu thích. Menu `…` cho phép chỉnh sửa, nhân bản,
kiểm tra cổng TCP, mở SFTP hoặc xóa kết nối. Nhân bản không sao chép mật khẩu.
Xóa kết nối chỉ xóa cấu hình cục bộ, không xóa file trên server.

## SSH

Mật khẩu có thể lưu mã hóa hoặc chỉ giữ trong bộ nhớ. Cấu hình không kèm mật khẩu
sẽ yêu cầu nhập khi kết nối. Với khóa SSH, chọn file private key OpenSSH/PEM;
nhập passphrase trong biểu mẫu nếu khóa được mã hóa. `.ppk` cần chuyển đổi trước.

SSH agent cần Windows OpenSSH Authentication Agent được bật và đã nạp khóa.
App sử dụng named pipe của agent hoặc SSH_AUTH_SOCK nếu có.

Đối chiếu dấu vân tay máy chủ mới với quản trị viên qua một kênh đáng tin cậy.
Nếu khóa đã lưu không khớp, app chặn kết nối; không xóa khóa chỉ để bỏ qua cảnh báo.

Terminal hỗ trợ ứng dụng toàn màn hình như vim/htop qua PTY. Resize cửa sổ được gửi
đến server. Ngắt SSH có thể dừng tiến trình phụ thuộc phiên; sử dụng tmux/screen
trên máy chủ nếu muốn duy trì công việc sau khi ngắt.

Copy lệnh từ ứng dụng bên ngoài, nhấp vào terminal rồi nhấn **Ctrl + V** để dán.
Có thể dùng Ctrl + Shift + V, Shift + Insert hoặc nút **Dán** trên thanh công cụ.
Sao chép phần đang chọn bằng Ctrl + Shift + C hoặc nút Sao chép; Ctrl + C vẫn ngắt lệnh.
Lệnh một dòng không tự thêm Enter. Lệnh nhiều dòng dùng bracketed paste khi shell bật chế độ này.

## SFTP

Mở File SFTP trong phiên SSH hoặc tạo kết nối SFTP riêng. Cột trái là máy tính này,
cột phải là máy chủ. Có thể nhập trực tiếp đường dẫn. Nút thư mục ở cột trái mở
hộp thoại chọn thư mục. Nhấp đúp hoặc Enter để vào thư mục; nút ↑ đi về thư mục cha.

- Chọn file bên trái rồi Tải lên, hoặc nhấn upload trên cột phải để chọn nhiều file.
- Chọn file bên phải rồi Tải xuống; Windows hỏi nơi lưu. Nhấp đúp file cũng tải xuống.
- Nút thư mục mới, đổi tên và xóa trên cột phải thao tác trên server.
- Xóa thư mục chỉ hỗ trợ thư mục rỗng; app xác nhận trước khi xóa.
- Theo dõi tiến độ ở Truyền file; nút X hủy tác vụ đang chạy.

Hiện truyền theo file; chưa hỗ trợ kéo thả, truyền thư mục đệ quy hoặc resume.
Symlink có dấu ↗; truyền file từ xa theo hành vi stat của server. Symlink cục bộ
không upload được bằng nút chọn dòng. Mất mạng khi upload có thể để lại file .part.

## Lệnh đã lưu

Lưu tên và nội dung lệnh nhiều dòng. Dùng Sao chép hoặc chọn một terminal đang mở
trong menu Chèn vào terminal. Xterm xử lý bracketed paste nếu shell bật chế độ đó.
**Lệnh nhiều dòng có thể chạy ngay khi paste nếu shell không hỗ trợ bracketed paste;
hãy kiểm tra nội dung trước.**

## RDP

Kết nối RDP mở Windows Remote Desktop trong cửa sổ riêng. Windows hỏi thông tin
đăng nhập và xử lý xác thực máy chủ. User lưu trong app là thông tin tham chiếu;
app không đưa mật khẩu vào dòng lệnh hoặc Credential Manager.

## Sao lưu

Xuất cấu hình tạo JSON chứa kết nối và lệnh. Không kèm mật khẩu, nội dung khóa SSH
hoặc dấu vân tay tin cậy. Nhập bổ sung dữ liệu với ID mới; nhập hai lần tạo bản sao.
Trên máy/tài khoản Windows khác, nhập lại mật khẩu và chọn lại đường dẫn khóa SSH.

## Khắc phục sự cố

| Hiện tượng | Kiểm tra |
| --- | --- |
| Timeout / Unreachable | VPN, DNS, firewall, IP/cổng. TCP reachable chưa chứng minh SSH đăng nhập được. |
| Authentication failed | User, mật khẩu, phương thức được server cho phép, authorized_keys, passphrase. |
| Không tìm thấy SSH agent | Bật OpenSSH agent và nạp khóa; hoặc dùng mật khẩu/file khóa. |
| Khóa máy chủ thay đổi | Xác minh với quản trị viên; chỉ xóa khóa cũ sau khi xác nhận. |
| Không giải mã được mật khẩu | Nhập lại trên tài khoản Windows hiện tại. |
| SFTP Permission denied | Quyền thư mục/file và dịch vụ SFTP trên server. |
| Upload ghi đè thất bại | Server có thể thiếu atomic replacement; upload tên mới, kiểm tra rồi xử lý bản cũ. |
| Workspace bị hỏng | App giữ file gốc và báo thư mục dữ liệu; sao lưu trước khi khôi phục JSON. |
| Windows SmartScreen hỏi xác nhận | Bản đầu chưa ký số; đối chiếu nguồn GitHub và SHA-256 của release. |
