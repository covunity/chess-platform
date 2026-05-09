import { Navigate, Outlet, Routes, Route } from 'react-router-dom'
import './i18n'
import { AuthProvider } from './context/AuthContext'
import TopNav from './components/TopNav'
import Footer from './components/Footer'
import ProtectedAdminRoute from './components/admin/ProtectedAdminRoute'
import AdminLayout from './components/admin/AdminLayout'
import AdminUsersPage from './pages/admin/AdminUsersPage'
import AdminReportsPage from './pages/admin/AdminReportsPage'
import AdminOrdersPage from './pages/admin/AdminOrdersPage'
import AdminCreatorApplicationsPage from './pages/admin/AdminCreatorApplicationsPage'
import AdminSettingsPage from './pages/admin/AdminSettingsPage'
import AdminComingSoonPage from './pages/admin/AdminComingSoonPage'
import ProtectedCreatorRoute from './components/creator/ProtectedCreatorRoute'
import CreatorLayout from './components/creator/CreatorLayout'
import CreatorStudioPage from './pages/creator/CreatorStudioPage'
import NewCoursePage from './pages/creator/NewCoursePage'
import CourseEditPage from './pages/creator/CourseEditPage'
import HomePage from './pages/HomePage'
import CourseDetailPage from './pages/CourseDetailPage'
import LessonPlayerPage from './pages/LessonPlayerPage'
import PracticePage from './pages/PracticePage'
import LearnerDashboardPage from './pages/LearnerDashboardPage'
import AccountOrdersPage from './pages/AccountOrdersPage'
import BecomeCreatorPage from './pages/BecomeCreatorPage'
import TermsPage from './pages/TermsPage'
import PrivacyPage from './pages/PrivacyPage'
import ProfilePage from './pages/ProfilePage'
import NotFoundPage from './pages/NotFoundPage'
import SignUpPage from './pages/SignUpPage'
import LoginPage from './pages/LoginPage'
import ForgotPasswordPage from './pages/ForgotPasswordPage'
import CheckEmailPage from './pages/CheckEmailPage'
import ResetPasswordPage from './pages/ResetPasswordPage'
import CheckoutPage from './pages/CheckoutPage'
import CheckoutAwaitingPage from './pages/CheckoutAwaitingPage'

function PublicShell() {
  return (
    <div className="min-h-screen flex flex-col bg-(--bg)">
      <TopNav />
      <div className="flex-1">
        <Outlet />
      </div>
      <Footer />
    </div>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        {/* Admin section — own layout, no TopNav/Footer */}
        <Route path="/admin" element={<ProtectedAdminRoute />}>
          <Route element={<AdminLayout />}>
            <Route index element={<Navigate to="users" replace />} />
            <Route path="users" element={<AdminUsersPage />} />
            <Route path="orders" element={<AdminOrdersPage />} />
            <Route path="creator-applications" element={<AdminCreatorApplicationsPage />} />
            <Route path="reports" element={<AdminReportsPage />} />
            <Route path="settings" element={<AdminSettingsPage />} />
            <Route path="*" element={<AdminComingSoonPage />} />
          </Route>
        </Route>

        {/* Creator section — own layout */}
        <Route path="/creator" element={<ProtectedCreatorRoute />}>
          <Route element={<CreatorLayout />}>
            <Route index element={<CreatorStudioPage />} />
            <Route path="courses/new" element={<NewCoursePage />} />
            <Route path="courses/:courseId/edit" element={<CourseEditPage />} />
          </Route>
        </Route>

        {/* Lesson player — full screen, no TopNav/Footer */}
        <Route path="/learn/:courseId/:lessonId" element={<LessonPlayerPage />} />
        <Route path="/learn/:courseId" element={<LessonPlayerPage />} />

        {/* Public section — with TopNav + Footer */}
        <Route element={<PublicShell />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/practice" element={<PracticePage />} />
          <Route path="/dashboard" element={<LearnerDashboardPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/account/orders" element={<AccountOrdersPage />} />
          <Route path="/become-creator" element={<BecomeCreatorPage />} />
          <Route path="/register-business" element={<BecomeCreatorPage />} />
          <Route path="/courses/:courseId" element={<CourseDetailPage />} />
          <Route path="/checkout/:orderId" element={<CheckoutPage />} />
          <Route path="/checkout/:orderId/awaiting" element={<CheckoutAwaitingPage />} />
          <Route path="/terms" element={<TermsPage />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/signup" element={<SignUpPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/check-email" element={<CheckEmailPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </AuthProvider>
  )
}
