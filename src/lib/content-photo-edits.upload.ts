import type { ContentPhotoEdit } from './content-photo-edits'
import { photoEditUploadUrl } from './content-photo-edits'

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
