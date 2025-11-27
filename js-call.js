// js-call.js - WebRTC Calling Logic with Audio/Video Separation & History Log

// ভিডিও এলিমেন্ট
const localVideo = document.getElementById('local-video');
const remoteVideo = document.getElementById('remote-video');

// মোডাল এবং স্ট্যাটাস টেক্সট
const callModal = document.getElementById('call-interface-modal'); 
const incomingCallModal = document.getElementById('incoming-call-modal');
const callStatus = document.getElementById('call-status');
const callPartnerName = document.getElementById('call-partner-name');

// নতুন UI লেয়ার (অডিও এবং ভিডিও আলাদা করার জন্য)
const videoUiLayer = document.getElementById('video-ui-layer');
const audioUiLayer = document.getElementById('audio-ui-layer');
const audioCallName = document.getElementById('audio-call-name-display');
const audioCallStatus = document.getElementById('audio-call-status-text');
const audioCallTimerDisplay = document.getElementById('audio-call-timer');

// ভেরিয়েবল
let localStream;
let peerConnection;
let currentCallRef;
let incomingCallData = null;
let activeCallPartnerId = null; // যার সাথে কথা হচ্ছে তার আইডি
let isCurrentCallVideo = false; // কলটি ভিডিও নাকি অডিও
let callTimerInterval; // টাইমার এর জন্য
let callStartTime; // কখন কল শুরু হলো

// STUN Servers (ফ্রি গুগল সার্ভার)
const servers = {
    iceServers: [
        { urls: ['stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'] }
    ]
};

// ==========================================
// 1. কল শুরু করার ফাংশন (Start Call - Caller Side)
// ==========================================
async function startCall(isVideo) {
    // চেক করা হচ্ছে currentChatId আছে কিনা
    if (typeof currentChatId === 'undefined' || !currentChatId) {
        alert("Please select a friend to call first!");
        return;
    }
    
    activeCallPartnerId = currentChatId;
    isCurrentCallVideo = isVideo;

    try {
        // UI সেটআপ (ভিডিও না অডিও)
        setupCallUI(isVideo, true); // true means 'outgoing call'

        // মিডিয়া পারমিশন (অডিও হলে video: false যাবে)
        localStream = await navigator.mediaDevices.getUserMedia({ video: isVideo, audio: true });
        
        // ভিডিও কলে নিজের চেহারা দেখানো, অডিও কলে ভিডিও ট্যাগ অফ থাকবে
        if (isVideo) {
            localVideo.srcObject = localStream;
        }

        // Peer Connection তৈরি
        createPeerConnection(activeCallPartnerId);

        // Offer তৈরি করা
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);

        // Firebase এ কল রিকোয়েস্ট পাঠানো
        const callId = db.ref('calls').push().key;
        currentCallRef = db.ref(`calls/${activeCallPartnerId}/${callId}`);
        
        // নিজের নাম সংগ্রহ
        const myNameElement = document.getElementById('profile-view-name');
        const myName = myNameElement ? myNameElement.textContent : "Unknown";

        await currentCallRef.set({
            callerId: currentUser.uid,
            callerName: myName, 
            type: 'offer',
            isVideo: isVideo,
            sdp: JSON.stringify(peerConnection.localDescription)
        });

        // সিগন্যালিং শোনা (Call Answered?)
        listenForAnswer(activeCallPartnerId, callId);

    } catch (error) {
        console.error("Error starting call:", error);
        alert("Could not access device. Check permissions.");
        endCall(false); // false মানে সেভ করার দরকার নেই কারণ কানেক্টই হয়নি
    }
}

// ==========================================
// 2. UI কন্ট্রোল ফাংশন (Audio vs Video UI)
// ==========================================
function setupCallUI(isVideo, isOutgoing, partnerName = null) {
    callModal.classList.remove('hidden');
    
    // নাম ঠিক করা
    let displayName = "Friend";
    if (partnerName) {
        displayName = partnerName;
    } else if (document.getElementById('chat-header-name')) {
        displayName = document.getElementById('chat-header-name').textContent;
    }

    if (isVideo) {
        // ভিডিও মোড
        videoUiLayer.classList.remove('hidden');
        audioUiLayer.classList.add('hidden');
        callPartnerName.textContent = displayName;
        callStatus.textContent = isOutgoing ? "Calling..." : "Connecting...";
    } else {
        // অডিও মোড (WhatsApp স্টাইল)
        videoUiLayer.classList.add('hidden');
        audioUiLayer.classList.remove('hidden');
        audioCallName.textContent = displayName;
        audioCallStatus.textContent = isOutgoing ? "Calling..." : "Connecting...";
        audioCallTimerDisplay.textContent = ""; // টাইমার রিসেট
    }
}

// ==========================================
// 3. Peer Connection সেটআপ
// ==========================================
function createPeerConnection(partnerId) {
    peerConnection = new RTCPeerConnection(servers);

    // স্ট্রিম যোগ করা
    if(localStream) {
        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
        });
    }

    // রিমোট স্ট্রিম রিসিভ করা
    peerConnection.ontrack = (event) => {
        // ভিডিও এলিমেন্টে স্ট্রিম দেওয়া (অডিও কল হলেও এটি কাজ করবে, শুধু ভিডিও দেখা যাবে না)
        remoteVideo.srcObject = event.streams[0];
    };

    // কানেকশন স্টেট মনিটর করা (টাইমার চালু করার জন্য)
    peerConnection.onconnectionstatechange = () => {
        if (peerConnection.connectionState === 'connected') {
            startCallTimer();
            const statusText = "Connected";
            callStatus.textContent = statusText;
            audioCallStatus.textContent = statusText;
        }
    };

    // ICE Candidate হ্যান্ডেল করা
    peerConnection.onicecandidate = (event) => {
        if (event.candidate && currentCallRef) {
            currentCallRef.child('candidates').push(JSON.stringify(event.candidate));
        }
    };
}

// ==========================================
// 4. টাইমার লজিক (Call Duration)
// ==========================================
function startCallTimer() {
    callStartTime = Date.now();
    
    if (callTimerInterval) clearInterval(callTimerInterval);

    callTimerInterval = setInterval(() => {
        const now = Date.now();
        const diff = now - callStartTime;

        const minutes = Math.floor(diff / 60000);
        const seconds = Math.floor((diff % 60000) / 1000);

        const timeString = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        
        // UI আপডেট
        audioCallTimerDisplay.textContent = timeString;
        // ভিডিও কলেও চাইলে স্ট্যাটাসে সময় দেখানো যায়
        if(isCurrentCallVideo) {
            callStatus.textContent = timeString;
        }
    }, 1000);
}

// ==========================================
// 5. ইনকামিং কল শোনা (Listen for Calls)
// ==========================================
function listenForIncomingCalls() {
    if (!currentUser) return;
    
    const myCallsRef = db.ref(`calls/${currentUser.uid}`);
    myCallsRef.off(); // আগের লিসেনার রিমুভ

    myCallsRef.on('child_added', (snapshot) => {
        const data = snapshot.val();
        if (data && data.type === 'offer') {
            incomingCallData = { ...data, key: snapshot.key };
            // কলার আইডি সেট করা যাতে পরে কল ব্যাক বা হিস্ট্রি সেভ করা যায়
            activeCallPartnerId = data.callerId;
            showIncomingCallUI(data.callerName, data.isVideo);
        }
    });
    
    // কলার কল কেটে দিলে
    myCallsRef.on('child_removed', (snapshot) => {
         hideIncomingCallUI();
         endCallUI(); 
    });
}

function showIncomingCallUI(name, isVideo) {
    const callerNameEl = document.getElementById('incoming-caller-name');
    const msg = isVideo ? "Incoming Video Call..." : "Incoming Audio Call...";
    
    if(callerNameEl) callerNameEl.textContent = name;
    // ইনকামিং মোডালে টেক্সট চেঞ্জ করা যেতে পারে (অপশনাল)
    const incomingText = document.querySelector('#incoming-call-modal p');
    if(incomingText) incomingText.textContent = msg;

    if(incomingCallModal) incomingCallModal.classList.remove('hidden');
}

function hideIncomingCallUI() {
    if(incomingCallModal) incomingCallModal.classList.add('hidden');
}

function endCallUI() {
    if(callModal) callModal.classList.add('hidden');
    
    if(localVideo) localVideo.srcObject = null;
    if(remoteVideo) remoteVideo.srcObject = null;
    
    audioCallTimerDisplay.textContent = "";
    clearInterval(callTimerInterval);
}

// ==========================================
// 6. কল রিসিভ করা (Answer Call - Receiver Side)
// ==========================================
const acceptBtn = document.getElementById('accept-call-btn');
if(acceptBtn) {
    acceptBtn.addEventListener('click', async () => {
        hideIncomingCallUI();
        
        // ইনকামিং কলের টাইপ (ভিডিও/অডিও) চেক করে UI সেট করা
        isCurrentCallVideo = incomingCallData.isVideo;
        setupCallUI(isCurrentCallVideo, false, incomingCallData.callerName);

        try {
            // রিসিভারের মিডিয়া সেটআপ
            localStream = await navigator.mediaDevices.getUserMedia({ 
                video: isCurrentCallVideo, 
                audio: true 
            });
            
            if (isCurrentCallVideo) {
                localVideo.srcObject = localStream;
            }

            peerConnection = new RTCPeerConnection(servers);
            
            // স্ট্রিম যোগ
            localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

            // রিমোট স্ট্রিম সেট
            peerConnection.ontrack = (event) => {
                remoteVideo.srcObject = event.streams[0];
            };
            
            // কানেকশন মনিটর (টাইমারের জন্য)
            peerConnection.onconnectionstatechange = () => {
                if (peerConnection.connectionState === 'connected') {
                    startCallTimer();
                    const statusText = "Connected";
                    callStatus.textContent = statusText;
                    audioCallStatus.textContent = statusText;
                }
            };

            // রিমোট অফার সেট
            await peerConnection.setRemoteDescription(JSON.parse(incomingCallData.sdp));

            // উত্তর (Answer) তৈরি
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);

            // Firebase এ উত্তর পাঠানো
            currentCallRef = db.ref(`calls/${currentUser.uid}/${incomingCallData.key}`);
            await currentCallRef.update({
                type: 'answer',
                sdp: JSON.stringify(peerConnection.localDescription)
            });
            
            // ICE Candidate
            peerConnection.onicecandidate = (event) => {
                if (event.candidate) {
                    currentCallRef.child('candidates').push(JSON.stringify(event.candidate));
                }
            };
            
            currentCallRef.child('candidates').on('child_added', (snapshot) => {
                const candidate = JSON.parse(snapshot.val());
                if(peerConnection.remoteDescription) {
                     peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
                }
            });

        } catch (e) {
            console.error(e);
            endCall(false);
        }
    });
}

// ==========================================
// 7. Caller এর জন্য Answer শোনা
// ==========================================
function listenForAnswer(friendId, callId) {
    const callRef = db.ref(`calls/${friendId}/${callId}`);
    
    callRef.on('value', async (snapshot) => {
        const data = snapshot.val();
        if (data && data.type === 'answer' && !peerConnection.currentRemoteDescription) {
            const answer = JSON.parse(data.sdp);
            await peerConnection.setRemoteDescription(answer);
        }
    });

    callRef.child('candidates').on('child_added', (snapshot) => {
        const candidate = JSON.parse(snapshot.val());
        if(peerConnection && peerConnection.remoteDescription) {
            peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        }
    });
}

// ==========================================
// 8. কল কেটে দেওয়া এবং হিস্ট্রি সেভ (End Call)
// ==========================================
function endCall(shouldSaveLog = true) {
    // 1. কানেকশন বন্ধ করা
    if (peerConnection) peerConnection.close();
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }
    
    // 2. ডিউরেশন ক্যালকুলেট করা (লগ সেভ করার জন্য)
    let durationText = "0s";
    if (callStartTime) {
        const diff = Date.now() - callStartTime;
        const minutes = Math.floor(diff / 60000);
        const seconds = Math.floor((diff % 60000) / 1000);
        if (minutes > 0) durationText = `${minutes}m ${seconds}s`;
        else durationText = `${seconds}s`;
    }

    // 3. UI রিসেট
    endCallUI();
    hideIncomingCallUI();
    
    // 4. Firebase থেকে কল ডাটা ডিলিট
    if (currentCallRef) currentCallRef.remove();
    
    // 5. চ্যাট হিস্ট্রিতে কল লগ সেভ করা (যদি কানেক্ট হয়ে থাকে)
    if (shouldSaveLog && activeCallPartnerId && callStartTime) {
        saveCallLogToChat(activeCallPartnerId, durationText, isCurrentCallVideo);
    }

    // রিসেট ভেরিয়েবল
    peerConnection = null;
    localStream = null;
    currentCallRef = null;
    callStartTime = null;
    activeCallPartnerId = null;
}

// চ্যাট লিস্টে কল লগ সেভ করার ফাংশন
function saveCallLogToChat(partnerId, duration, isVideo) {
    // চ্যাট আইডি জেনারেট (যাতে দুইজনের চ্যাটেই সেভ হয়)
    // নোট: getChatId ফাংশনটি js-chat.js এ আছে বলে ধরে নেওয়া হলো, তাই এখানে ম্যানুয়ালি বানাচ্ছি
    // কারণ js-call.js আগে লোড হতে পারে। লজিক সেইম রাখা হচ্ছে।
    const uid1 = currentUser.uid;
    const uid2 = partnerId;
    const chatId = uid1 < uid2 ? `${uid1}_${uid2}` : `${uid2}_${uid1}`;

    const messageRef = db.ref(`messages/${chatId}`).push();
    
    messageRef.set({
        sender: currentUser.uid,
        type: 'call_log', // নতুন টাইপ
        message: 'Call ended', // ডিফল্ট টেক্সট
        callDuration: duration,
        callType: isVideo ? 'video' : 'audio',
        timestamp: Date.now()
    });
}

// ==========================================
// 9. বাটন ইভেন্ট লিসেনার
// ==========================================
const videoCallBtn = document.getElementById('header-video-call-btn');
const audioCallBtn = document.getElementById('header-audio-call-btn');
const modalVideoBtn = document.getElementById('modal-video-call-btn');
const modalAudioBtn = document.getElementById('modal-audio-call-btn');
const endCallBtn = document.getElementById('end-call-btn');
const rejectCallBtn = document.getElementById('reject-call-btn');

// চ্যাট হেডার থেকে কল
if(videoCallBtn) videoCallBtn.addEventListener('click', () => startCall(true));
if(audioCallBtn) audioCallBtn.addEventListener('click', () => startCall(false));

// প্রোফাইল মোডাল থেকে কল
if(modalVideoBtn) {
    modalVideoBtn.addEventListener('click', () => {
        document.getElementById('partner-profile-modal').classList.add('hidden');
        startCall(true);
    });
}
if(modalAudioBtn) {
    modalAudioBtn.addEventListener('click', () => {
        document.getElementById('partner-profile-modal').classList.add('hidden');
        startCall(false);
    });
}

// কল কাটা
if(endCallBtn) endCallBtn.addEventListener('click', () => endCall(true));

// কল রিজেক্ট
if(rejectCallBtn) {
    rejectCallBtn.addEventListener('click', () => {
        hideIncomingCallUI();
        if(incomingCallData) {
            // শুধু রিমুভ করে দিলেই Caller এর কাছে 'removed' ইভেন্ট ফায়ার হবে
            db.ref(`calls/${currentUser.uid}/${incomingCallData.key}`).remove();
        }
        activeCallPartnerId = null;
    });
}

// মাইক্রোফোন টগল (Mute/Unmute)
const micToggleBtn = document.getElementById('mic-toggle-btn');
if (micToggleBtn) {
    micToggleBtn.addEventListener('click', () => {
        if (localStream) {
            const audioTrack = localStream.getAudioTracks()[0];
            if (audioTrack) {
                audioTrack.enabled = !audioTrack.enabled;
                // আইকন কালার চেঞ্জ (User Feedback)
                micToggleBtn.style.background = audioTrack.enabled ? 'rgba(255,255,255,0.2)' : '#ff3b30';
            }
        }
    });
}

// ক্যামেরা টগল (Camera On/Off inside call)
const camToggleBtn = document.getElementById('camera-toggle-btn');
if (camToggleBtn) {
    camToggleBtn.addEventListener('click', () => {
        // যদি অডিও মোডে থাকি, ক্যামেরা অন করা যাবে না (বা চাইলে লজিক এড করতে পারো)
        if (!isCurrentCallVideo) {
            alert("Switching to video is not supported yet."); 
            return;
        }

        if (localStream) {
            const videoTrack = localStream.getVideoTracks()[0];
            if (videoTrack) {
                videoTrack.enabled = !videoTrack.enabled;
                camToggleBtn.style.background = videoTrack.enabled ? 'rgba(255,255,255,0.2)' : '#ff3b30';
            }
        }
    });
}

// ইনিশিয়ালাইজেশন
const checkAuthInterval = setInterval(() => {
    if (typeof firebase !== 'undefined' && firebase.auth()) {
        clearInterval(checkAuthInterval);
        firebase.auth().onAuthStateChanged((user) => {
            if (user) {
                listenForIncomingCalls();
            }
        });
    }
}, 500);