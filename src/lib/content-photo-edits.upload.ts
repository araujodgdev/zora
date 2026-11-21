import type { ContentPhotoEdit } from './content-photo-edits'
import { photoEditUploadUrl, photoEditVersionsUrl } from './content-photo-edits'

/**
 * Sends an original to `POST /api/content/<itemId>/photo-edits` as the raw
 * request body and resolves with the new edit's id and name. Uses
 * XMLHttpRequest because `fetch` cannot report upload progress. Rejects with
 * a readable message.
 */
export function uploadPhotoEditOriginal(
  itemId: string,
  file: File,
  name?: string,
  onProgress?: (fraction: number) => void,
): Promise<Pick<ContentPhotoEdit, 'id' | 'name'>> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open('POST', photoEditUploadUrl(itemId, file.name, name))
    // Raws have no standard type; the server checks the extension and the bytes.
    request.setRequestHeader('Content-Type', 'application/octet-stream')
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded / event.total)
    }
    request.onerror = () =>
      reject(new Error(`${file.name}: o envio falhou. Verifique sua conexão.`))
    request.onload = () => {
      let body: { error?: string; edit?: Pick<ContentPhotoEdit, 'id' | 'name'> } = {}
      try {
        body = JSON.parse(request.responseText) as typeof body
      } catch {
        // Not JSON: fall through to the generic message.
      }
      if (request.status >= 200 && request.status < 300 && body.edit) return resolve(body.edit)
      reject(new Error(body.error || `${file.name}: o envio falhou (${request.status}).`))
    }
    request.send(file)
  })
}

/** What `POST /api/photo-edits/<id>/versions` answered. */
export type PhotoEditVersionSaveResult =
  | { kind: 'saved'; versionId: string; number: number }
  | {
      kind: 'conflict'
      error: string
      currentVersionId: string | null
      currentVersionNumber: number | null
    }

/**
 * Saves a version from the editor page: multipart `settings` (the
 * `develop.get` text), `preview` (the JPEG) and `baseVersionId` (empty for
 * the first save). Resolves with the new version or the 409 conflict;
 * rejects with the server's message for anything else.
 */
export async function savePhotoEditVersion(
  editId: string,
  input: { settingsText: string; preview: ArrayBuffer; baseVersionId: string | null },
  fetcher: typeof fetch = fetch,
): Promise<PhotoEditVersionSaveResult> {
  const form = new FormData()
  form.set('settings', new Blob([input.settingsText], { type: 'application/json' }), 'settings.json')
  form.set('preview', new Blob([input.preview], { type: 'image/jpeg' }), 'preview.jpg')
  form.set('baseVersionId', input.baseVersionId ?? '')
  let response: Response
  try {
    response = await fetcher(photoEditVersionsUrl(editId), {
      method: 'POST',
      body: form,
      credentials: 'same-origin',
    })
  } catch {
    throw new Error('Não foi possível salvar: verifique sua conexão.')
  }
  let body: Record<string, unknown> = {}
  try {
    body = (await response.json()) as Record<string, unknown>
  } catch {
    // Not JSON: the generic messages below.
  }
  const error = typeof body.error === 'string' && body.error ? body.error : null
  if (response.status === 201 && typeof body.versionId === 'string' && typeof body.number === 'number') {
    return { kind: 'saved', versionId: body.versionId, number: body.number }
  }
  if (response.status === 409) {
    return {
      kind: 'conflict',
      error: error ?? 'Outra pessoa salvou uma versão mais nova.',
      currentVersionId: typeof body.currentVersionId === 'string' ? body.currentVersionId : null,
      currentVersionNumber:
        typeof body.currentVersionNumber === 'number' ? body.currentVersionNumber : null,
    }
  }
  throw new Error(error ?? `Não foi possível salvar a edição de foto (${response.status}).`)
}
