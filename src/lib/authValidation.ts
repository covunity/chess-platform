export interface SignUpErrors {
  name?: string
  email?: string
  password?: string
  confirmPassword?: string
  tos?: string
}

export interface LoginErrors {
  email?: string
  password?: string
}

export function validateSignUp(
  name: string,
  email: string,
  password: string,
  confirmPassword: string,
  tosAccepted: boolean
): SignUpErrors {
  const errors: SignUpErrors = {}

  if (!name.trim()) {
    errors.name = 'validation.required'
  } else if (name.trim().length < 2) {
    errors.name = 'validation.nameTooShort'
  } else if (name.trim().length > 100) {
    errors.name = 'validation.nameTooLong'
  }

  if (!email.trim()) {
    errors.email = 'validation.required'
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.email = 'validation.emailInvalid'
  }

  if (!password) {
    errors.password = 'validation.required'
  } else if (password.length < 8) {
    errors.password = 'validation.passwordTooShort'
  } else if (!/[A-Z]/.test(password)) {
    errors.password = 'validation.passwordNeedsUppercase'
  } else if (!/[0-9]/.test(password)) {
    errors.password = 'validation.passwordNeedsNumber'
  }

  if (!confirmPassword) {
    errors.confirmPassword = 'validation.required'
  } else if (password !== confirmPassword) {
    errors.confirmPassword = 'validation.passwordsNoMatch'
  }

  if (!tosAccepted) {
    errors.tos = 'validation.tosRequired'
  }

  return errors
}

export function validateLogin(email: string, password: string): LoginErrors {
  const errors: LoginErrors = {}

  if (!email.trim()) {
    errors.email = 'validation.required'
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.email = 'validation.emailInvalid'
  }

  if (!password) {
    errors.password = 'validation.required'
  }

  return errors
}

export function validateEmail(email: string): { email?: string } {
  if (!email.trim()) return { email: 'validation.required' }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { email: 'validation.emailInvalid' }
  return {}
}

export function validateNewPassword(
  password: string,
  confirmPassword: string
): { password?: string; confirmPassword?: string } {
  const errors: { password?: string; confirmPassword?: string } = {}

  if (!password) {
    errors.password = 'validation.required'
  } else if (password.length < 8) {
    errors.password = 'validation.passwordTooShort'
  } else if (!/[A-Z]/.test(password)) {
    errors.password = 'validation.passwordNeedsUppercase'
  } else if (!/[0-9]/.test(password)) {
    errors.password = 'validation.passwordNeedsNumber'
  }

  if (!confirmPassword) {
    errors.confirmPassword = 'validation.required'
  } else if (password !== confirmPassword) {
    errors.confirmPassword = 'validation.passwordsNoMatch'
  }

  return errors
}
