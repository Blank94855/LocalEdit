import { logger } from "@vendetta";
import { ReactNative } from "@vendetta/metro/common";
import { findByProps, findByName } from "@vendetta/metro";
import { before, after } from "@vendetta/patcher";
import { showInputAlert } from "@vendetta/ui/alerts";

// Store for local message edits (resets on app restart)
const messageEdits: { [messageId: string]: string } = {};

let unpatchRender: (() => void) | null = null;
let unpatchContextMenu: (() => void) | null = null;

export default {
    onLoad: () => {
        logger.info("Local Message Editor plugin loaded");
        
        try {
            // Find message content component
            const MessageContent = findByProps("MessageContent")?.MessageContent ?? findByName("MessageContent");
            
            if (MessageContent) {
                // Patch message rendering to show edited content
                unpatchRender = before("render", MessageContent.prototype, function(args) {
                    const message = this.props?.message;
                    
                    if (message?.id && messageEdits[message.id]) {
                        // Create a modified props object with edited content
                        this.props = {
                            ...this.props,
                            message: {
                                ...message,
                                content: messageEdits[message.id]
                            }
                        };
                    }
                });
            }

            // Find and patch the context menu
            const { getByProps } = findByProps("openContextMenuLazy", "closeContextMenu");
            const ContextMenuActions = getByProps ?? findByProps("openContextMenuLazy");
            
            if (ContextMenuActions) {
                unpatchContextMenu = before("openContextMenuLazy", ContextMenuActions, (args) => {
                    const [event, menuComponent] = args;
                    
                    // Wrap the original menu component
                    args[1] = (props: any) => {
                        const originalMenu = menuComponent(props);
                        const message = props?.message;
                        
                        // Only add edit option for messages that aren't from the current user
                        if (message && message.author?.id !== props.currentUserId) {
                            const editButton = {
                                id: "edit-locally",
                                label: messageEdits[message.id] ? "Edit Local Copy" : "Edit Locally",
                                icon: findByName("PencilIcon"),
                                action: () => {
                                    const currentEdit = messageEdits[message.id] || message.content;
                                    
                                    showInputAlert({
                                        title: "Edit Message Locally",
                                        placeholder: "Enter new message content...",
                                        initialValue: currentEdit,
                                        confirmText: "Save",
                                        onConfirm: (newContent: string) => {
                                            if (newContent.trim() === "") {
                                                delete messageEdits[message.id];
                                                logger.info(`Removed local edit for message ${message.id}`);
                                            } else {
                                                messageEdits[message.id] = newContent;
                                                logger.info(`Locally edited message ${message.id}`);
                                            }
                                            
                                            // Force UI update
                                            try {
                                                ReactNative.InteractionManager?.runAfterInteractions?.(() => {
                                                    // Trigger re-render
                                                });
                                            } catch (e) {
                                                // Fallback - just log
                                                logger.info("Edit saved, may need to scroll to see changes");
                                            }
                                        }
                                    });
                                }
                            };

                            // Add remove edit option if message is currently edited
                            const removeButton = messageEdits[message.id] ? {
                                id: "remove-local-edit",
                                label: "Remove Local Edit",
                                icon: findByName("TrashIcon"),
                                destructive: true,
                                action: () => {
                                    delete messageEdits[message.id];
                                    logger.info(`Removed local edit for message ${message.id}`);
                                }
                            } : null;

                            // Add our buttons to the menu
                            if (originalMenu?.props?.children) {
                                const children = Array.isArray(originalMenu.props.children) 
                                    ? originalMenu.props.children 
                                    : [originalMenu.props.children];
                                
                                children.push(editButton);
                                if (removeButton) {
                                    children.push(removeButton);
                                }
                                
                                originalMenu.props.children = children;
                            }
                        }
                        
                        return originalMenu;
                    };
                });
            }

            // Register debug functions globally (optional)
            (global as any).showLocalEdits = () => {
                const editCount = Object.keys(messageEdits).length;
                logger.info(`Currently have ${editCount} local message edits`);
                console.log(messageEdits);
                return messageEdits;
            };

            (global as any).clearAllEdits = () => {
                Object.keys(messageEdits).forEach(key => delete messageEdits[key]);
                logger.info("Cleared all local message edits");
            };

            logger.info("Local message editor loaded successfully!");
            logger.info("Long-press any message to see edit options");

        } catch (error) {
            logger.error("Failed to setup message editor:", error);
        }
    },
    
    onUnload: () => {
        logger.info("Local Message Editor plugin unloaded");
        
        // Clean up patches
        if (unpatchRender) {
            unpatchRender();
            unpatchRender = null;
        }
        
        if (unpatchContextMenu) {
            unpatchContextMenu();
            unpatchContextMenu = null;
        }
        
        // Clean up global functions
        delete (global as any).showLocalEdits;
        delete (global as any).clearAllEdits;
        
        // Clear stored edits
        Object.keys(messageEdits).forEach(key => delete messageEdits[key]);
        
        logger.info("Message edits cleared and patches removed");
    },
}
