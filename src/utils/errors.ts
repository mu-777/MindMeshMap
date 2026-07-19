/**
 * 認証（アクセストークン）が失効している/失効した状態でDrive APIを呼び出そうとした際にthrowするエラー。
 * 呼び出し側はこれを判別して再ログイン導線（トースト等）を出す。
 */
export class AuthExpiredError extends Error {
  constructor(message = 'Google認証の有効期限が切れています') {
    super(message);
    this.name = 'AuthExpiredError';
  }
}
