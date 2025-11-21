// this.createPredefinedMessagesSection();

// createPredefinedMessagesSection() {
//     const privateBoxEl =
//         document.getElementById('priv_input');
//
//     if (!privateBoxEl) {
//         console.warn('[CA] createPredefinedMessagesSection: private area not found');
//         return;
//     }
//
//     this.createPredefinedMessagesBar({
//         container: privateBoxEl,
//         messageBarName: 'ca-predefined-messages-select-private-chat',
//         targetTextBoxSelector: '#private_input_box #message_content'
//     });
// }


// createPredefinedMessagesBar({container, messageBarName, targetTextBoxSelector, appendAtStart}) {
//     if (!container) {
//         console.error('[CA] createPredefinedMessagesBar: container is missing');
//         return;
//     }
//
//     if (!messageBarName || !targetTextBoxSelector || !appendAtStart === undefined) {
//         console.error('[CA] createPredefinedMessagesBar: invalid options', {
//             container,
//             messageBarName,
//             targetTextBoxSelector,
//             appendAtStart
//         });
//         return;
//     }
//
//     // Avoid duplicating if bar already exists here
//     if (container.querySelector(`#${messageBarName}`)) {
//         return;
//     }
//
//     const wrapper = document.createElement('div');
//     wrapper.className = 'ca-predefined-messages-bar';
//
//     wrapper.innerHTML = `
//     <div class="ca-predefined-messages-bar-inner">
//         <label class="ca-predefined-messages-label">
//             <select id="${messageBarName}"
//                     class="ca-predefined-messages-select"
//                     data-predefined-messages-target="${targetTextBoxSelector}">
//                 <option value="">Select pre-defined message…</option>
//             </select>
//         </label>
//
//         <div class="ca-predefined-messages-bar-actions">
//
//             <!-- SEND AGAIN -->
//             <a href="#"
//                id="${messageBarName}-resend"
//                class="ca-log-action ca-log-action-filled ca-predefined-messages-resend"
//                title="Insert again">
//                ${this.buildSvgIconString("lucide lucide-triangle-right",
//         `<path d="M8 4l12 8-12 8V4z"></path>`)}
//             </a>
//
//             <!-- ADD NEW FROM CURRENT TEXT -->
//             <a href="#"
//                id="${messageBarName}-add"
//                class="ca-log-action ca-predefined-messages-add"
//                title="Save current text as template">
//                ${this.buildSvgIconString("lucide lucide-lucide-plus",
//         `<line x1="12" y1="5" x2="12" y2="19"></line>
//                     <line x1="5" y1="12" x2="19" y2="12"></line>`)}
//             </a>
//
//             <!-- MANAGE -->
//             <a href="#"
//                id="${messageBarName}-manage"
//                class="ca-log-action ca-predefined-messages-manage"
//                title="Manage templates">
//                ${this.buildSvgIconString("lucide lucide-pencil",
//         `<path d="M17 3a2.828 2.828 0 0 1 4 4L9 19l-4 1 1-4L17 3z"></path>`)}
//             </a>
//
//         </div>
//     </div>
//     `;
//
//     if (appendAtStart) {
//         container.prepend(wrapper);
//     } else {
//         container.appendChild(wrapper);
//     }
//
//     // ⬇️ Separate wiring step
//     this.wirePredefinedMessagesBar(wrapper);
// }

// const broadcastPopupBodyEl = broadcastPopupEl.querySelector('.ca-popup-body');

// this.createPredefinedMessagesBar({
//     container: broadcastPopupBodyEl,
//     messageBarName: 'ca-predefined-messages-select-broadcast',
//     targetTextBoxSelector: '#ca-bc-msg',
//     appendAtStart: true
// });
