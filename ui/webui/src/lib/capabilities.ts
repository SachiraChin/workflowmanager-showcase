/**
 * Client Capabilities.
 *
 * Defines the capabilities that WebUI supports and sends to the server.
 * Capabilities correspond to user.* modules that require client interaction.
 *
 * Keep in sync with contracts/capabilities.py
 */

// WebUI capabilities - supports all interaction types
export const WEBUI_CAPABILITIES: string[] = [
  "user.text_input",    // Text input (single or multi-line)
  "user.select",        // Structured selection from options
  "user.form",          // Table-style form input with schema
  "user.pause",         // Pause/continue with message display
  "user.file_input",    // File upload/selection
  "media.generate",     // Media generation and selection (images/videos)
];
