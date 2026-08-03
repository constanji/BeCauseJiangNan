/**
 * Markdown rendering utilities
 */
import { marked } from 'marked'

// Configure marked options
marked.setOptions({
  breaks: true, // Convert '\n' to <br>
  gfm: true, // GitHub Flavored Markdown
  headerIds: false,
  mangle: false,
})

/**
 * Render markdown to HTML
 * @param {string} markdown - Markdown text
 * @returns {string} HTML string
 */
export function renderMarkdown(markdown) {
  if (!markdown || typeof markdown !== 'string') {
    return ''
  }
  
  try {
    return marked.parse(markdown)
  } catch (error) {
    console.error('Error rendering markdown:', error)
    // Return escaped HTML if parsing fails
    return markdown.replace(/</g, '&lt;').replace(/>/g, '&gt;')
  }
}

/**
 * Check if text contains markdown syntax
 * @param {string} text - Text to check
 * @returns {boolean}
 */
export function hasMarkdown(text) {
  if (!text || typeof text !== 'string') {
    return false
  }
  
  // Simple check for common markdown patterns
  const markdownPatterns = [
    /^#{1,6}\s/m, // Headers
    /\*\*.*?\*\*/, // Bold
    /\*.*?\*/, // Italic
    /\[.*?\]\(.*?\)/, // Links
    /```[\s\S]*?```/, // Code blocks
    /`.*?`/, // Inline code
    /^\s*[-*+]\s/m, // Lists
    /^\s*\d+\.\s/m, // Numbered lists
    /^>\s/m, // Blockquotes
  ]
  
  return markdownPatterns.some(pattern => pattern.test(text))
}

