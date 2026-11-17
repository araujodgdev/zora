import { assetUploadUrl } from './content-assets'

/**
 * Sends a file to `POST /api/content/<itemId>/assets` as the raw request body
 * and resolves when the server stored it. Uses XMLHttpRequest because `fetch`
 * cannot report upload progress. Rejects with a readable message.
 */
export function uploadContentAsset(
  itemId: string,
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open('POST', assetUploadUrl(itemId, file.name))
    request.setRequestHeader('Content-Type', file.type)
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded / event.total)
    }
    request.onerror = () =>
      reject(new Error(`${file.name}: o envio falhou. Verifique sua conexão.`))
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) return resolve()
      let message = ''
      try {
        message = (JSON.parse(request.responseText) as { error?: string }).error ?? ''
      } catch {
        // Not JSON: fall through to the generic message.
      }
      reject(new Error(message || `${file.name}: o envio falhou (${request.status}).`))
    }
    request.send(file)
  })
}
