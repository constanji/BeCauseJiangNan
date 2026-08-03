/**
 * LocalStorage utilities for chat history
 */
import { generateId } from './snowflake'

const STORAGE_KEY_CONVERSATIONS = 'because_conversations'
const STORAGE_KEY_MESSAGES = 'because_messages'
const STORAGE_KEY_THOUGHT_CHAINS = 'because_thought_chains'

/**
 * Get all conversations from localStorage
 * @returns {Array} Array of conversation items
 */
export function getConversations() {
  try {
    const data = localStorage.getItem(STORAGE_KEY_CONVERSATIONS)
    return data ? JSON.parse(data) : []
  } catch (error) {
    console.error('Error reading conversations from localStorage:', error)
    return []
  }
}

/**
 * Save conversations to localStorage
 * @param {Array} conversations - Array of conversation items
 */
export function saveConversations(conversations) {
  try {
    localStorage.setItem(STORAGE_KEY_CONVERSATIONS, JSON.stringify(conversations))
  } catch (error) {
    console.error('Error saving conversations to localStorage:', error)
    // Handle quota exceeded error
    if (error.name === 'QuotaExceededError') {
      // Remove oldest conversations
      const sorted = [...conversations].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
      const limited = sorted.slice(0, 50) // Keep only 50 most recent
      localStorage.setItem(STORAGE_KEY_CONVERSATIONS, JSON.stringify(limited))
    }
  }
}

/**
 * Get messages for a specific conversation
 * @param {string} conversationId - Conversation ID
 * @returns {Array} Array of messages
 */
export function getMessages(conversationId) {
  if (!conversationId) return []

  try {
    const data = localStorage.getItem(`${STORAGE_KEY_MESSAGES}_${conversationId}`)
    return data ? JSON.parse(data) : []
  } catch (error) {
    console.error('Error reading messages from localStorage:', error)
    return []
  }
}

/**
 * Save messages for a specific conversation
 * @param {string} conversationId - Conversation ID
 * @param {Array} messages - Array of messages
 */
export function saveMessages(conversationId, messages) {
  if (!conversationId) return

  try {
    localStorage.setItem(`${STORAGE_KEY_MESSAGES}_${conversationId}`, JSON.stringify(messages))
  } catch (error) {
    console.error('Error saving messages to localStorage:', error)
    if (error.name === 'QuotaExceededError') {
      // Keep only last 100 messages
      const limited = messages.slice(-100)
      localStorage.setItem(`${STORAGE_KEY_MESSAGES}_${conversationId}`, JSON.stringify(limited))
    }
  }
}

/**
 * Get thought chain items for a specific conversation
 * @param {string} conversationId - Conversation ID
 * @returns {Array} Array of thought chain items
 */
export function getThoughtChain(conversationId) {
  if (!conversationId) return []

  try {
    const data = localStorage.getItem(`${STORAGE_KEY_THOUGHT_CHAINS}_${conversationId}`)
    return data ? JSON.parse(data) : []
  } catch (error) {
    console.error('Error reading thought chain from localStorage:', error)
    return []
  }
}

/**
 * Save thought chain items for a specific conversation
 * @param {string} conversationId - Conversation ID
 * @param {Array} thoughtChainItems - Array of thought chain items
 */
export function saveThoughtChain(conversationId, thoughtChainItems) {
  if (!conversationId) return

  try {
    localStorage.setItem(`${STORAGE_KEY_THOUGHT_CHAINS}_${conversationId}`, JSON.stringify(thoughtChainItems))
  } catch (error) {
    console.error('Error saving thought chain to localStorage:', error)
  }
}

/**
 * Delete a conversation and its related data
 * @param {string} conversationId - Conversation ID to delete
 */
export function deleteConversation(conversationId) {
  if (!conversationId) return

  try {
    // Remove from conversations list
    const conversations = getConversations()
    const filtered = conversations.filter(c => c.key !== conversationId)
    saveConversations(filtered)

    // Remove messages
    localStorage.removeItem(`${STORAGE_KEY_MESSAGES}_${conversationId}`)

    // Remove thought chain
    localStorage.removeItem(`${STORAGE_KEY_THOUGHT_CHAINS}_${conversationId}`)
  } catch (error) {
    console.error('Error deleting conversation:', error)
  }
}

/**
 * Generate a new conversation ID using SnowFlake
 * @returns {string} Generated conversation ID
 */
export function generateConversationId() {
  return generateId()
}

/**
 * Add or update a conversation in the list
 * @param {string} conversationId - Conversation ID
 * @param {string} title - Conversation title (optional, will use first message if not provided)
 * @param {number} timestamp - Timestamp (optional, defaults to now)
 * @param {string} projectId - Project ID (required for new conversations)
 * @param {string} datasourceId - Datasource ID (required for new conversations)
 * @param {string} orgCode - User org code for index-ask projects (optional)
 */
export function addConversation(conversationId, title = null, timestamp = null, projectId = null, datasourceId = null, orgCode = null) {
  const conversations = getConversations()

  // Check if conversation already exists
  const existingIndex = conversations.findIndex(c => c.key === conversationId)

  const conversationItem = {
    key: conversationId,
    label: title || `对话 ${conversationId.slice(0, 8)}`,
    timestamp: timestamp || Date.now(),
    projectId: projectId,
    datasourceId: datasourceId,
    orgCode: orgCode,
  }

  if (existingIndex >= 0) {
    // Update existing conversation
    conversations[existingIndex] = {
      ...conversations[existingIndex],
      ...conversationItem,
      timestamp: conversations[existingIndex].timestamp || conversationItem.timestamp,
      // Keep existing fields if not provided
      projectId: projectId || conversations[existingIndex].projectId,
      datasourceId: datasourceId || conversations[existingIndex].datasourceId,
      orgCode: orgCode || conversations[existingIndex].orgCode,
    }
  } else {
    // Add new conversation at the beginning
    conversations.unshift(conversationItem)
  }

  // Sort by timestamp (newest first) and limit to 100 conversations
  const sorted = conversations.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
  const limited = sorted.slice(0, 100)

  saveConversations(limited)

  return conversationItem
}

/**
 * Get conversation by ID
 * @param {string} conversationId - Conversation ID
 * @returns {Object|null} Conversation object or null
 */
export function getConversation(conversationId) {
  const conversations = getConversations()
  return conversations.find(c => c.key === conversationId) || null
}

/**
 * Get conversation title from first user message
 * @param {Array} messages - Array of messages
 * @returns {string} Title (first 20 characters of first user message)
 */
export function getConversationTitle(messages) {
  const firstUserMessage = messages.find(m => m.role === 'user')
  if (firstUserMessage && firstUserMessage.content) {
    const content = typeof firstUserMessage.content === 'string'
      ? firstUserMessage.content
      : String(firstUserMessage.content)
    return content.substring(0, 30).trim() || '新对话'
  }
  return '新对话'
}

