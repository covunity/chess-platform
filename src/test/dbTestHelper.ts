import { execSync } from 'child_process'

let _isDockerDbAvailable: boolean | null = null

/**
 * Checks whether the local Supabase PostgreSQL Docker container is running
 * and ready to accept queries.
 *
 * In CI environments (like GitHub Actions) where the local development
 * database container is not running, database-level integration tests are
 * automatically skipped.
 */
export function isDockerDbAvailable(): boolean {
  if (_isDockerDbAvailable !== null) {
    return _isDockerDbAvailable
  }

  if (process.env.CI && !process.env.RUN_DOCKER_DB_TESTS) {
    _isDockerDbAvailable = false
    return false
  }

  try {
    const res = execSync(
      'docker exec -i supabase_db_chess-course-platform psql -U postgres -d postgres -t -A -q -c "SELECT 1;"',
      {
        stdio: ['pipe', 'pipe', 'pipe'],
        encoding: 'utf-8',
        timeout: 2000,
      }
    ).trim()
    _isDockerDbAvailable = res === '1'
  } catch {
    _isDockerDbAvailable = false
  }

  return _isDockerDbAvailable
}
