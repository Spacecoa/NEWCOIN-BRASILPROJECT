export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const badRequest = (msg, details) => new HttpError(400, msg, details);
export const unauthorized = (msg = 'Não autenticado') => new HttpError(401, msg);
export const forbidden = (msg = 'Sem permissão') => new HttpError(403, msg);
export const notFound = (msg = 'Não encontrado') => new HttpError(404, msg);
export const conflict = (msg) => new HttpError(409, msg);

/** Valida `data` com um schema zod e lança 400 com os detalhes do erro. */
export function parse(schema, data) {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw badRequest(
      'Dados inválidos',
      result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  return result.data;
}
