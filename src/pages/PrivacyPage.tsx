export default function PrivacyPage() {
  return (
    <main data-testid="privacy-page" className="max-w-3xl mx-auto px-6 py-16">
      <h1 className="font-serif text-3xl mb-6">Chính sách quyền riêng tư</h1>
      <p className="text-(--ink-2) text-sm mb-8">Cập nhật lần cuối: 24 tháng 5, 2026</p>

      <div className="prose" style={{ color: 'var(--ink-2)', lineHeight: 1.75, fontSize: 15 }}>
        <p>
          Covunity (&ldquo;chúng tôi&rdquo;, &ldquo;nền tảng&rdquo;) cam kết bảo vệ quyền riêng tư của bạn.
          Chính sách này giải thích cách chúng tôi thu thập, sử dụng và bảo vệ thông tin cá nhân khi bạn
          sử dụng trang web và dịch vụ của Covunity.
        </p>

        <h2 className="font-serif text-xl mt-10 mb-4" style={{ color: 'var(--ink-1)' }}>1. Thông tin chúng tôi thu thập</h2>

        <h3 className="font-medium text-base mt-6 mb-2" style={{ color: 'var(--ink-1)' }}>1.1. Thông tin bạn cung cấp trực tiếp</h3>
        <ul style={{ paddingLeft: 20, listStyleType: 'disc' }}>
          <li>Họ tên, địa chỉ email và mật khẩu khi đăng ký tài khoản.</li>
          <li>Ảnh đại diện (avatar) nếu bạn tải lên.</li>
          <li>Thông tin thanh toán: mã đơn hàng và xác nhận chuyển khoản (chúng tôi <strong>không</strong> lưu trữ số thẻ ngân hàng).</li>
          <li>Nội dung bạn tạo: khóa học, bài học, bình luận, đánh giá.</li>
        </ul>

        <h3 className="font-medium text-base mt-6 mb-2" style={{ color: 'var(--ink-1)' }}>1.2. Thông tin từ đăng nhập mạng xã hội</h3>
        <p>
          Khi bạn đăng nhập bằng Google hoặc Facebook, chúng tôi nhận được:
        </p>
        <ul style={{ paddingLeft: 20, listStyleType: 'disc' }}>
          <li>Tên hiển thị và ảnh đại diện từ tài khoản Google/Facebook của bạn.</li>
          <li>Địa chỉ email đã xác minh bởi nhà cung cấp.</li>
        </ul>
        <p>
          Chúng tôi <strong>không</strong> truy cập danh bạ, bài đăng, danh sách bạn bè hoặc bất kỳ dữ liệu nào
          khác từ tài khoản mạng xã hội của bạn ngoài thông tin hồ sơ công khai (tên và ảnh).
        </p>

        <h3 className="font-medium text-base mt-6 mb-2" style={{ color: 'var(--ink-1)' }}>1.3. Thông tin thu thập tự động</h3>
        <ul style={{ paddingLeft: 20, listStyleType: 'disc' }}>
          <li>Địa chỉ IP, loại trình duyệt, hệ điều hành.</li>
          <li>Dữ liệu sử dụng: các trang đã truy cập, thời gian xem bài học, tiến độ khóa học.</li>
          <li>Dữ liệu lưu trữ cục bộ (localStorage): tùy chọn giao diện, phiên đăng nhập.</li>
        </ul>

        <h2 className="font-serif text-xl mt-10 mb-4" style={{ color: 'var(--ink-1)' }}>2. Mục đích sử dụng thông tin</h2>
        <ul style={{ paddingLeft: 20, listStyleType: 'disc' }}>
          <li>Cung cấp, duy trì và cải thiện dịch vụ Covunity.</li>
          <li>Xử lý đơn hàng và xác nhận thanh toán.</li>
          <li>Hiển thị tiến độ học tập và gợi ý khóa học phù hợp.</li>
          <li>Gửi thông báo liên quan đến tài khoản (xác nhận đăng ký, đặt lại mật khẩu, cập nhật đơn hàng).</li>
          <li>Phát hiện và ngăn chặn hoạt động gian lận hoặc vi phạm điều khoản.</li>
        </ul>

        <h2 className="font-serif text-xl mt-10 mb-4" style={{ color: 'var(--ink-1)' }}>3. Chia sẻ thông tin</h2>
        <p>Chúng tôi <strong>không bán</strong> thông tin cá nhân của bạn cho bên thứ ba. Thông tin chỉ được chia sẻ trong các trường hợp sau:</p>
        <ul style={{ paddingLeft: 20, listStyleType: 'disc' }}>
          <li><strong>Nhà cung cấp dịch vụ:</strong> Supabase (lưu trữ cơ sở dữ liệu và xác thực), Vercel (hosting), VietQR (tạo mã QR thanh toán). Các bên này chỉ xử lý dữ liệu theo hướng dẫn của chúng tôi.</li>
          <li><strong>Nghĩa vụ pháp lý:</strong> Khi được yêu cầu bởi pháp luật Việt Nam hoặc cơ quan có thẩm quyền.</li>
          <li><strong>Người tạo khóa học:</strong> Khi bạn mua khóa học, người tạo có thể thấy tên và email của bạn cho mục đích hỗ trợ học viên.</li>
        </ul>

        <h2 className="font-serif text-xl mt-10 mb-4" style={{ color: 'var(--ink-1)' }}>4. Lưu trữ và bảo mật</h2>
        <ul style={{ paddingLeft: 20, listStyleType: 'disc' }}>
          <li>Dữ liệu được lưu trữ trên cơ sở hạ tầng Supabase (PostgreSQL) với mã hóa khi truyền (TLS) và khi lưu trữ.</li>
          <li>Mật khẩu được mã hóa bằng bcrypt — chúng tôi không lưu mật khẩu ở dạng văn bản thuần.</li>
          <li>Video bài học được bảo vệ bằng URL có chữ ký (signed URLs) với thời hạn giới hạn.</li>
          <li>Quyền truy cập dữ liệu được kiểm soát bằng Row Level Security (RLS) ở cấp cơ sở dữ liệu.</li>
        </ul>

        <h2 className="font-serif text-xl mt-10 mb-4" style={{ color: 'var(--ink-1)' }}>5. Cookie và lưu trữ cục bộ</h2>
        <p>
          Covunity sử dụng localStorage để lưu phiên đăng nhập và tùy chọn giao diện.
          Chúng tôi không sử dụng cookie theo dõi của bên thứ ba. Không có quảng cáo trên nền tảng.
        </p>

        <h2 className="font-serif text-xl mt-10 mb-4" style={{ color: 'var(--ink-1)' }}>6. Quyền của bạn</h2>
        <p>Bạn có quyền:</p>
        <ul style={{ paddingLeft: 20, listStyleType: 'disc' }}>
          <li><strong>Truy cập:</strong> Xem thông tin cá nhân trong trang Hồ sơ.</li>
          <li><strong>Chỉnh sửa:</strong> Cập nhật tên, ảnh đại diện, mật khẩu bất kỳ lúc nào.</li>
          <li><strong>Xóa tài khoản:</strong> Gửi yêu cầu xóa tài khoản qua email hỗ trợ. Chúng tôi sẽ xóa dữ liệu trong vòng 30 ngày, trừ dữ liệu cần giữ theo quy định pháp luật.</li>
          <li><strong>Hủy liên kết mạng xã hội:</strong> Bạn có thể hủy kết nối Google/Facebook khỏi tài khoản thông qua trang Hồ sơ (nếu đã thiết lập mật khẩu).</li>
          <li><strong>Xuất dữ liệu:</strong> Liên hệ với chúng tôi để nhận bản sao dữ liệu cá nhân.</li>
        </ul>

        <h2 className="font-serif text-xl mt-10 mb-4" style={{ color: 'var(--ink-1)' }}>7. Bảo vệ trẻ em</h2>
        <p>
          Covunity không hướng đến trẻ em dưới 13 tuổi. Nếu phát hiện tài khoản thuộc về trẻ em dưới 13 tuổi,
          chúng tôi sẽ xóa tài khoản và dữ liệu liên quan.
        </p>

        <h2 className="font-serif text-xl mt-10 mb-4" style={{ color: 'var(--ink-1)' }}>8. Thay đổi chính sách</h2>
        <p>
          Khi chính sách này thay đổi, chúng tôi sẽ cập nhật ngày &ldquo;Cập nhật lần cuối&rdquo; ở đầu trang.
          Với những thay đổi quan trọng, chúng tôi sẽ thông báo qua email hoặc banner trên trang web.
        </p>

        <h2 className="font-serif text-xl mt-10 mb-4" style={{ color: 'var(--ink-1)' }}>9. Liên hệ</h2>
        <p>
          Nếu có câu hỏi về chính sách quyền riêng tư, vui lòng liên hệ:
        </p>
        <ul style={{ paddingLeft: 20, listStyleType: 'disc' }}>
          <li>Email: <a href="mailto:support@gambitly.com" className="link-accent">support@gambitly.com</a></li>
        </ul>
      </div>
    </main>
  )
}
