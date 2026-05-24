export default function DataDeletionPage() {
  return (
    <main data-testid="data-deletion-page" className="max-w-3xl mx-auto px-6 py-16">
      <h1 className="font-serif text-3xl mb-6">Hướng dẫn xóa dữ liệu</h1>
      <p className="text-sm mb-8" style={{ color: 'var(--ink-3)' }}>Cập nhật lần cuối: 24 tháng 5, 2026</p>

      <div className="prose" style={{ color: 'var(--ink-2)', lineHeight: 1.75, fontSize: 15 }}>
        <p>
          Gambitly tôn trọng quyền kiểm soát dữ liệu của bạn. Trang này hướng dẫn cách yêu cầu
          xóa tài khoản và toàn bộ dữ liệu cá nhân liên quan.
        </p>

        <h2 className="font-serif text-xl mt-10 mb-4" style={{ color: 'var(--ink-1)' }}>1. Dữ liệu nào sẽ bị xóa?</h2>
        <p>Khi yêu cầu xóa tài khoản, chúng tôi sẽ xóa vĩnh viễn:</p>
        <ul style={{ paddingLeft: 20, listStyleType: 'disc' }}>
          <li>Thông tin hồ sơ: tên, email, ảnh đại diện, tiểu sử.</li>
          <li>Liên kết đăng nhập mạng xã hội (Google, Facebook).</li>
          <li>Tiến độ học tập, bookmark, bình luận và đánh giá.</li>
          <li>Lịch sử đơn hàng (ẩn danh hóa sau xóa — giữ lại cho mục đích kế toán theo quy định).</li>
        </ul>

        <h2 className="font-serif text-xl mt-10 mb-4" style={{ color: 'var(--ink-1)' }}>2. Đối với tài khoản Creator</h2>
        <p>
          Nếu bạn là người tạo khóa học, các khóa học đã xuất bản sẽ bị gỡ khỏi nền tảng.
          Học viên đã đăng ký sẽ không thể truy cập nội dung sau khi tài khoản bị xóa.
          Vui lòng thông báo cho học viên trước khi gửi yêu cầu xóa.
        </p>

        <h2 className="font-serif text-xl mt-10 mb-4" style={{ color: 'var(--ink-1)' }}>3. Cách yêu cầu xóa dữ liệu</h2>

        <h3 className="font-medium text-base mt-6 mb-2" style={{ color: 'var(--ink-1)' }}>Cách 1: Gửi email</h3>
        <ol style={{ paddingLeft: 20 }}>
          <li>Gửi email đến <a href="mailto:support@gambitly.com" className="link-accent">support@gambitly.com</a> với tiêu đề <strong>&ldquo;Yêu cầu xóa tài khoản&rdquo;</strong>.</li>
          <li>Sử dụng địa chỉ email đã đăng ký tài khoản Gambitly.</li>
          <li>Chúng tôi sẽ xác nhận yêu cầu qua email trong vòng 48 giờ.</li>
          <li>Dữ liệu sẽ được xóa hoàn toàn trong vòng <strong>30 ngày</strong> kể từ khi xác nhận.</li>
        </ol>

        <h3 className="font-medium text-base mt-6 mb-2" style={{ color: 'var(--ink-1)' }}>Cách 2: Đăng nhập bằng Facebook và thu hồi quyền</h3>
        <p>Nếu bạn đăng nhập bằng Facebook, bạn cũng có thể:</p>
        <ol style={{ paddingLeft: 20 }}>
          <li>Vào <strong>Facebook &rarr; Cài đặt &rarr; Ứng dụng và trang web</strong>.</li>
          <li>Tìm <strong>Gambitly</strong> trong danh sách.</li>
          <li>Nhấn <strong>Xóa</strong> &rarr; chọn <strong>&ldquo;Xóa tất cả bài viết, ảnh và video trên Gambitly&rdquo;</strong>.</li>
          <li>Gambitly sẽ nhận được thông báo và tiến hành xóa dữ liệu của bạn.</li>
        </ol>

        <h2 className="font-serif text-xl mt-10 mb-4" style={{ color: 'var(--ink-1)' }}>4. Thời gian xử lý</h2>
        <ul style={{ paddingLeft: 20, listStyleType: 'disc' }}>
          <li><strong>Xác nhận yêu cầu:</strong> trong vòng 48 giờ.</li>
          <li><strong>Xóa dữ liệu:</strong> tối đa 30 ngày kể từ khi xác nhận.</li>
          <li>Một số dữ liệu có thể được giữ lại thêm tối đa 90 ngày trong bản sao lưu (backup) trước khi bị xóa hoàn toàn.</li>
        </ul>

        <h2 className="font-serif text-xl mt-10 mb-4" style={{ color: 'var(--ink-1)' }}>5. Liên hệ</h2>
        <p>
          Nếu có câu hỏi về việc xóa dữ liệu, vui lòng liên hệ:
        </p>
        <ul style={{ paddingLeft: 20, listStyleType: 'disc' }}>
          <li>Email: <a href="mailto:support@gambitly.com" className="link-accent">support@gambitly.com</a></li>
        </ul>
      </div>
    </main>
  )
}
