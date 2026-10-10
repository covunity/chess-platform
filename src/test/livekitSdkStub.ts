export class AccessToken {
  static instances: AccessToken[] = []
  static toJwtCalls = 0

  apiKey: string
  apiSecret: string
  options: Record<string, unknown>
  grants: Record<string, unknown>[] = []

  constructor(apiKey: string, apiSecret: string, options: Record<string, unknown>) {
    this.apiKey = apiKey
    this.apiSecret = apiSecret
    this.options = options
    AccessToken.instances.push(this)
  }

  get metadata(): string | undefined {
    return this.options.metadata as string | undefined
  }

  get identity(): string | undefined {
    return this.options.identity as string | undefined
  }

  addGrant(grant: Record<string, unknown>): void {
    this.grants.push(grant)
  }

  async toJwt(): Promise<string> {
    AccessToken.toJwtCalls++
    return 'mock-jwt-token'
  }

  static reset(): void {
    AccessToken.instances = []
    AccessToken.toJwtCalls = 0
  }
}
