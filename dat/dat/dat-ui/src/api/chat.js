/**
 * Chat API Service
 * Handles SSE streaming requests and user interactions
 */

const BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8080'

/**
 * Parse SSE event stream
 */
function parseSSE(data) {
  const lines = data.split('\n')
  const event = { type: 'message', data: null }
  let dataLines = []

  for (const line of lines) {
    if (line.startsWith('event:')) {
      event.type = line.substring(6).trim()
    } else if (line.startsWith('data:')) {
      // Collect all data lines (SSE allows multiple data lines)
      dataLines.push(line.substring(5))
    }
  }

  // Join all data lines and parse JSON
  if (dataLines.length > 0) {
    const jsonData = dataLines.join('\n').trim()
    if (jsonData) {
      try {
        const parsed = JSON.parse(jsonData)
        // If parsed result is an object with error/message, use it
        // Otherwise, keep the parsed object
        event.data = parsed
      } catch (e) {
        // If not valid JSON, use as string
        // This handles cases where error messages come as plain text
        event.data = jsonData
      }
    }
  }

  return event
}

/**
 * Ask data with SSE streaming
 * @param {Object} params - Request parameters
 * @param {string} params.question - User question
 * @param {string} [params.project_id] - Project ID for MongoDB mode
 * @param {string} [params.datasource_id] - Datasource ID for semantic model selection
 * @param {string} [params.conversation_id] - Conversation ID for continuing conversation
 * @param {string} [params.agent_name] - Agent name (default: 'default')
 * @param {Object} callbacks - Event callbacks
 * @param {Function} callbacks.onMessage - Called for each SSE event
 * @param {Function} callbacks.onError - Called on error
 * @param {Function} callbacks.onFinish - Called when stream finishes
 * @returns {Function} Abort function to cancel the request
 */
export function askStream(params, callbacks = {}) {
  const { onMessage, onError, onFinish } = callbacks

  const controller = new AbortController()
  const { signal } = controller

  const url = `${BASE_URL}/api/v1/ask/stream`

  fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-User-Id': params.user_id || '',
      'X-Agent-Id': params.agent_id || '',
    },
    body: JSON.stringify({
      question: params.question,
      project_id: params.project_id,
      datasource_id: params.datasource_id,
      conversation_id: params.conversation_id,
      agent_name: params.agent_name || 'default',
      // 指标问数项目透传;非指标问数项目后端会忽略空值
      org_code: params.org_code,
    }),
    signal,
  })
    .then(async (response) => {
      if (!response.ok) {
        const errorText = await response.text().catch(() => '')
        throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`)
      }

      if (!response.body) {
        throw new Error('Response body is null')
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      try {
        while (true) {
          const { done, value } = await reader.read()

          if (done) {
            // Process remaining buffer
            if (buffer.trim()) {
              try {
                const event = parseSSE(buffer)
                if (onMessage && event.data !== null) {
                  onMessage(event.type, event.data)
                }
              } catch (e) {
                console.warn('Error parsing final buffer:', e)
              }
            }
            if (onFinish) onFinish()
            break
          }

          buffer += decoder.decode(value, { stream: true })

          // Split by double newline (SSE event separator)
          const events = buffer.split('\n\n')

          // Keep the last incomplete event in buffer
          buffer = events.pop() || ''

          // Process complete events
          for (const eventData of events) {
            if (eventData.trim()) {
              try {
                const event = parseSSE(eventData)
                // Only process if we have event type and data
                if (onMessage && (event.type || event.data !== null)) {
                  // If no event type specified, default to 'message'
                  const eventType = event.type || 'message'
                  onMessage(eventType, event.data)
                }
              } catch (e) {
                console.warn('Error parsing SSE event:', e, eventData)
                // Try to send as raw message if parsing fails
                if (onMessage) {
                  onMessage('message', eventData)
                }
              }
            }
          }
        }
      } catch (streamError) {
        console.error('Stream reading error:', streamError)
        if (onError) {
          onError(streamError)
        }
      }
    })
    .catch((error) => {
      if (error.name === 'AbortError') {
        console.log('Request aborted')
        return
      }

      console.error('Fetch error:', error)
      if (onError) {
        onError(error)
      }
    })

  return () => controller.abort()
}

/**
 * Send user response for HITL AI request
 * @param {Object} params
 * @param {string} params.conversation_id - Conversation ID
 * @param {string} params.user_response - User response
 */
export async function sendUserResponse(params) {
  const response = await fetch(`${BASE_URL}/api/v1/ask/user-response`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      conversation_id: params.conversation_id,
      user_response: params.user_response,
    }),
  })

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`)
  }

  return response.json()
}

/**
 * Send user approval for tool execution
 * @param {Object} params
 * @param {string} params.conversation_id - Conversation ID
 * @param {boolean} params.user_approval - User approval
 */
export async function sendUserApproval(params) {
  const response = await fetch(`${BASE_URL}/api/v1/ask/user-approval`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      conversation_id: params.conversation_id,
      user_approval: params.user_approval,
    }),
  })

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`)
  }

  return response.json()
}

/**
 * Get agents list
 */
export async function getAgents() {
  const response = await fetch(`${BASE_URL}/api/v1/agents`)
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`)
  }
  return response.json()
}

/**
 * Health check
 */
export async function healthCheck() {
  const response = await fetch(`${BASE_URL}/api/v1/health`)
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`)
  }
  return response.json()
}


