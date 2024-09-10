import {
  Connection,
  ConnectionConfig,
  getServerHealth,
  InteractionContext,
  ServerNotReady,
  WebSocketCloseHandler,
  WebSocketErrorHandler,
} from '@cardano-ogmios/client'
import WebSocket from 'ws'

export function createConnectionObject(config?: ConnectionConfig): Connection {
  const _128MB = 128 * 1024 * 1024
  const base = {
    host: config?.host ?? '127.0.0.1',
    port: config?.port ?? 1337,
    tls: config?.tls ?? false,
    maxPayload: config?.maxPayload ?? _128MB,
  }
  const hostAndPort = `${base.host}${config?.port ? ':' + config.port : ''}`
  return {
    ...base,
    address: {
      http: `${base.tls ? 'https' : 'http'}://${hostAndPort}`,
      webSocket: `${base.tls ? 'wss' : 'ws'}://${hostAndPort}`,
    },
  }
}
/**
 * Paste-and-copy implementation of
 * [createInteractionContext ](https://github.com/CardanoSolutions/ogmios/blob/de0a0ff/clients/TypeScript/packages/client/src/Connection.ts#L115)
 */
export async function createInteractionCtx(
  config: ConnectionConfig,
  errorHandler: WebSocketErrorHandler,
  closeHandler: WebSocketCloseHandler
): Promise<InteractionContext> {
  const connection: Connection = createConnectionObject(config)
  const health = await getServerHealth({connection})
  return new Promise((resolve, reject) => {
    if (health.lastTipUpdate === null) {
      return reject(new ServerNotReady(health))
    }
    const socket = new WebSocket(connection.address.webSocket, {
      maxPayload: connection.maxPayload,
      followRedirects: true,
    })

    const onInitialError = (error: Error) => {
      socket.removeAllListeners()
      return reject(error)
    }
    socket.setMaxListeners(10)
    socket.on('error', onInitialError)
    socket.once('close', (_code: number, reason: string) => {
      socket.removeAllListeners()
      reject(new Error(reason))
    })
    socket.on('open', async () => {
      socket.removeListener('error', onInitialError)
      socket.on('error', errorHandler)
      socket.on('close', closeHandler)
      resolve({
        connection,
        socket,
      })
    })
  })
}

export function harden(num: number): number {
  return 0x80000000 + num
}

export function parseStringToArray(value: string) {
  // Trim the input and remove the square brackets
  const trimmed = value.trim().slice(1, -1)

  // Regular expression to match quoted or unquoted values
  const elementRegex = /('[^']*'|"[^"]*"|[^,]+)/g

  const parsedArray = []
  let match

  // Use exec() to find all matches
  while ((match = elementRegex.exec(trimmed)) !== null) {
    let element = match[0].trim()

    // Remove surrounding quotes from quoted elements
    if (
      (element.startsWith("'") && element.endsWith("'")) ||
      (element.startsWith('"') && element.endsWith('"'))
    ) {
      element = element.slice(1, -1)
    }

    parsedArray.push(element)
  }

  return parsedArray
}

export function replaceBigInt(_: string, value: any): any {
  if (typeof value === 'bigint') {
    return value.toString()
  }

  return value
}
