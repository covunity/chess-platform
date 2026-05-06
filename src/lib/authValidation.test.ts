import { validateSignUp, validateLogin, validateEmail, validateNewPassword } from './authValidation'

describe('validateSignUp', () => {
  const valid = {
    name: 'John Doe',
    email: 'john@example.com',
    password: 'Password1',
    confirm: 'Password1',
    tos: true,
  }

  it('returns no errors for valid input', () => {
    expect(validateSignUp(valid.name, valid.email, valid.password, valid.confirm, valid.tos)).toEqual({})
  })

  it('requires name', () => {
    const e = validateSignUp('', valid.email, valid.password, valid.confirm, valid.tos)
    expect(e.name).toBe('validation.required')
  })

  it('rejects name shorter than 2 chars', () => {
    const e = validateSignUp('A', valid.email, valid.password, valid.confirm, valid.tos)
    expect(e.name).toBe('validation.nameTooShort')
  })

  it('rejects name longer than 100 chars', () => {
    const e = validateSignUp('A'.repeat(101), valid.email, valid.password, valid.confirm, valid.tos)
    expect(e.name).toBe('validation.nameTooLong')
  })

  it('requires email', () => {
    const e = validateSignUp(valid.name, '', valid.password, valid.confirm, valid.tos)
    expect(e.email).toBe('validation.required')
  })

  it('rejects invalid email format', () => {
    const e = validateSignUp(valid.name, 'not-an-email', valid.password, valid.confirm, valid.tos)
    expect(e.email).toBe('validation.emailInvalid')
  })

  it('requires password', () => {
    const e = validateSignUp(valid.name, valid.email, '', valid.confirm, valid.tos)
    expect(e.password).toBe('validation.required')
  })

  it('rejects password shorter than 8 chars', () => {
    const e = validateSignUp(valid.name, valid.email, 'Pass1', valid.confirm, valid.tos)
    expect(e.password).toBe('validation.passwordTooShort')
  })

  it('rejects password without uppercase', () => {
    const e = validateSignUp(valid.name, valid.email, 'password1', valid.confirm, valid.tos)
    expect(e.password).toBe('validation.passwordNeedsUppercase')
  })

  it('rejects password without number', () => {
    const e = validateSignUp(valid.name, valid.email, 'Password', valid.confirm, valid.tos)
    expect(e.password).toBe('validation.passwordNeedsNumber')
  })

  it('rejects mismatched confirm password', () => {
    const e = validateSignUp(valid.name, valid.email, valid.password, 'different', valid.tos)
    expect(e.confirmPassword).toBe('validation.passwordsNoMatch')
  })

  it('requires tos acceptance', () => {
    const e = validateSignUp(valid.name, valid.email, valid.password, valid.confirm, false)
    expect(e.tos).toBe('validation.tosRequired')
  })
})

describe('validateLogin', () => {
  it('returns no errors for valid input', () => {
    expect(validateLogin('user@example.com', 'anypassword')).toEqual({})
  })

  it('requires email', () => {
    expect(validateLogin('', 'pass').email).toBe('validation.required')
  })

  it('rejects invalid email', () => {
    expect(validateLogin('bad', 'pass').email).toBe('validation.emailInvalid')
  })

  it('requires password', () => {
    expect(validateLogin('user@example.com', '').password).toBe('validation.required')
  })
})

describe('validateEmail', () => {
  it('returns empty for valid email', () => {
    expect(validateEmail('a@b.com')).toEqual({})
  })

  it('returns required for empty', () => {
    expect(validateEmail('').email).toBe('validation.required')
  })

  it('returns invalid for bad format', () => {
    expect(validateEmail('bad').email).toBe('validation.emailInvalid')
  })
})

describe('validateNewPassword', () => {
  it('returns empty for valid passwords', () => {
    expect(validateNewPassword('Password1', 'Password1')).toEqual({})
  })

  it('requires password', () => {
    expect(validateNewPassword('', 'Password1').password).toBe('validation.required')
  })

  it('rejects short password', () => {
    expect(validateNewPassword('Pass1', 'Pass1').password).toBe('validation.passwordTooShort')
  })

  it('rejects no uppercase', () => {
    expect(validateNewPassword('password1', 'password1').password).toBe('validation.passwordNeedsUppercase')
  })

  it('rejects no number', () => {
    expect(validateNewPassword('Password', 'Password').password).toBe('validation.passwordNeedsNumber')
  })

  it('rejects mismatch', () => {
    expect(validateNewPassword('Password1', 'Password2').confirmPassword).toBe('validation.passwordsNoMatch')
  })
})
