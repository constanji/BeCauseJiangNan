import { BaseMessage, BaseMessageLike } from '@langchain/core/messages';
export declare const REMOVE_ALL_MESSAGES = "__remove_all__";
/**
 * Creates a message that instructs messagesStateReducer to remove ALL
 * existing messages from state.  Messages appearing after this one in
 * the array become the new state.
 *
 * Usage (in a node return value):
 * ```ts
 * return { messages: [createRemoveAllMessage(), ...survivingMessages] };
 * ```
 *
 * This works because the reducer checks for `getType() === 'remove'`
 * with `id === REMOVE_ALL_MESSAGES` and discards everything before it.
 *
 * NOTE: Uses RemoveMessage from @langchain/core with a sentinel id so
 * the reducer can distinguish a "remove-all" marker from a single-message
 * removal.
 */
export declare function createRemoveAllMessage(): BaseMessage;
export type Messages = Array<BaseMessage | BaseMessageLike> | BaseMessage | BaseMessageLike;
/**
 * Prebuilt reducer that combines returned messages.
 * Can handle standard messages and special modifiers like {@link RemoveMessage}
 * instances.
 */
export declare function messagesStateReducer(left: Messages, right: Messages): BaseMessage[];
