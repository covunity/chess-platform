import { Routes, Route } from 'react-router-dom'
import './i18n'
import { AuthProvider } from './context/AuthContext'
import TopNav from './components/TopNav'
import Footer from './components/Footer'
import HomePage from './pages/HomePage'
import TermsPage from './pages/TermsPage'
import PrivacyPage from './pages/PrivacyPage'
import NotFoundPage from './pages/NotFoundPage'
import SignUpPage from './pages/SignUpPage'
import LoginPage from './pages/LoginPage'
import ForgotPasswordPage from './pages/ForgotPasswordPage'
import CheckEmailPage from './pages/CheckEmailPage'
import ResetPasswordPage from './pages/ResetPasswordPage'

export default function App() {
  return (
    <AuthProvider>
      <div className="min-h-screen flex flex-col bg-[--bg]">
        <TopNav />
        <div className="flex-1">
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/terms" element={<TermsPage />} />
            <Route path="/privacy" element={<PrivacyPage />} />
            <Route path="/signup" element={<SignUpPage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/check-email" element={<CheckEmailPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </div>
        <Footer />
      </div>
    </AuthProvider>
  )
}
