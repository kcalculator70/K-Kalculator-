// js-call.js - WebRTC Calling Logic (Fixed for Mobile Devices)

// ভিডিও এলিমেন্ট
const localVideo = document.getElementById('local-video');
const remoteVideo = document.getElementById('remote-video');

// মোডাল এবং স্ট্যাটাস টেক্সট
const callModal = document.getElementById('call-interface-modal'); 
const incomingCallModal = document.getElementById('incoming-call-modal');
const callStatus = document.getElementById('call-status');
const callPartnerName = document.getElementById('call-partner-name');

// নতুন UI লেয়ার
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
let activeCallPartnerId = null;
let isCurrentCallVideo = false;
let callTimerInterval;
let callStartTime;

// STUN Servers
const servers = {
    iceServers: [
        { urls: ['stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'] }
    ]
};

// ==========================================
// 1. কল শুরু করার ফাংশন (Start Call - Caller Side)
// ==========================================
async function startCall(isVideo) {
    if (typeof currentChatId === 'undefined' || !currentChatId) {
        alert("Please select a friend to call first!");
        return;
    }
    
    activeCallPartnerId = currentChatId;
    isCurrentCallVideo = isVideo;

    try {
        // UI সেটআপ
        setupCallUI(isVideo, true);

        // [FIX] Constraints তৈরি করা (মোবাইলের জন্য নিরাপদ পদ্ধতি)
        const constraints = {
            audio: true,
            video: isVideo ? { facingMode: "user" } : false 
        };

        // ক্যামেরা/মাইক এক্সেস নেওয়া
        localStream = await navigator.mediaDevices.getUserMedia(constraints);
        
        // ভিডিও এলিমেন্টে স্ট্রিম সেট করা (শুধু ভিডিও কলের জন্য)
        if (isVideo && localVideo) {
            localVideo.srcObject = localStream;
        }

        // Peer Connection তৈরি
        createPeerConnection(activeCallPartnerId);

        // Offer তৈরি করা
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);

        // Firebase এ পাঠানো
        const callId = db.ref('calls').push().key;
        currentCallRef = db.ref(`calls/${activeCallPartnerId}/${callId}`);
        
        const myNameElement = document.getElementById('profile-view-name');
        const myName = myNameElement ? myNameElement.textContent : "Unknown";

        await currentCallRef.set({
            callerId: currentUser.uid,
            callerName: myName, 
            type: 'offer',
            isVideo: isVideo,
            sdp: JSON.stringify(peerConnection.localDescription)
        });

        listenForAnswer(activeCallPartnerId, callId);

    } catch (error) {
        console.error("Error starting call:", error);
        // [UPDATE] আসল এরর মেসেজ দেখালে সমস্যা বোঝা সহজ হবে
        alert("Device Error: " + error.name + " - " + error.message);
        endCall(false);
    }
}

// ==========================================
// 2. UI কন্ট্রোল ফাংশন
// ==========================================
function setupCallUI(isVideo, isOutgoing, partnerName = null) {
    callModal.classList.remove('hidden');
    
    let displayName = "Friend";
    if (partnerName) {
        displayName = partnerName;
    } else if (document.getElementById('chat-header-name')) {
        displayName = document.getElementById('chat-header-name').textContent;
    }

    if (isVideo) {
        videoUiLayer.classList.remove('hidden');
        audioUiLayer.classList.add('hidden');
        callPartnerName.textContent = displayName;
        callStatus.textContent = isOutgoing ? "Calling..." : "Connecting...";
    } else {
        videoUiLayer.classList.add('hidden');
        audioUiLayer.classList.remove('hidden');
        audioCallName.textContent = displayName;
        audioCallStatus.textContent = isOutgoing ? "Calling..." : "Connecting...";
        audioCallTimerDisplay.textContent = "";
    }
}

// ==========================================
// 3. Peer Connection সেটআপ
// ==========================================
function createPeerConnection(partnerId) {
    peerConnection = new RTCPeerConnection(servers);

    if(localStream) {
        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
        });
    }

    peerConnection.ontrack = (event) => {
        if(remoteVideo) remoteVideo.srcObject = event.streams[0];
    };

    peerConnection.onconnectionstatechange = () => {
        if (peerConnection.connectionState === 'connected') {
            startCallTimer();
            const statusText = "Connected";
            callStatus.textContent = statusText;
            audioCallStatus.textContent = statusText;
        }
    };

    peerConnection.onicecandidate = (event) => {
        if (event.candidate && currentCallRef) {
            currentCallRef.child('candidates').push(JSON.stringify(event.candidate));
        }
    };
}

// ==========================================
// 4. টাইমার লজিক
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
        
        audioCallTimerDisplay.textContent = timeString;
        if(isCurrentCallVideo) callStatus.textContent = timeString;
    }, 1000);
}

// ==========================================
// 5. ইনকামিং কল লিসেনার
// ==========================================
function listenForIncomingCalls() {
    if (!currentUser) return;
    
    const myCallsRef = db.ref(`calls/${currentUser.uid}`);
    myCallsRef.off();

    myCallsRef.on('child_added', (snapshot) => {
        const data = snapshot.val();
        if (data && data.type === 'offer') {
            incomingCallData = { ...data, key: snapshot.key };
            activeCallPartnerId = data.callerId;
            showIncomingCallUI(data.callerName, data.isVideo);
        }
    });
    
    myCallsRef.on('child_removed', (snapshot) => {
         hideIncomingCallUI();
         endCallUI(); 
    });
}

function showIncomingCallUI(name, isVideo) {
    const callerNameEl = document.getElementById('incoming-caller-name');
    const msg = isVideo ? "Incoming Video Call..." : "Incoming Audio Call...";
    
    if(callerNameEl) callerNameEl.textContent = name;
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
        
        isCurrentCallVideo = incomingCallData.isVideo;
        setupCallUI(isCurrentCallVideo, false, incomingCallData.callerName);

        try {
            // [FIX] রিসিভারের জন্যও সেইম constraints ব্যবহার করা
            const constraints = {
                audio: true,
                video: isCurrentCallVideo ? { facingMode: "user" } : false
            };

            localStream = await navigator.mediaDevices.getUserMedia(constraints);
            
            if (isCurrentCallVideo && localVideo) {
                localVideo.srcObject = localStream;
            }

            peerConnection = new RTCPeerConnection(servers);
            localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

            peerConnection.ontrack = (event) => {
                remoteVideo.srcObject = event.streams[0];
            };
            
            peerConnection.onconnectionstatechange = () => {
                if (peerConnection.connectionState === 'connected') {
                    startCallTimer();
                    const statusText = "Connected";
                    callStatus.textContent = statusText;
                    audioCallStatus.textContent = statusText;
                }
            };

            await peerConnection.setRemoteDescription(JSON.parse(incomingCallData.sdp));

            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);

            currentCallRef = db.ref(`calls/${currentUser.uid}/${incomingCallData.key}`);
            await currentCallRef.update({
                type: 'answer',
                sdp: JSON.stringify(peerConnection.localDescription)
            });
            
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
            alert("Answer Error: " + e.message);
            endCall(false);
        }
    });
}

// ==========================================
// 7. সিগন্যালিং এবং অন্যান্য
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

function endCall(shouldSaveLog = true) {
    if (peerConnection) peerConnection.close();
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }
    
    let durationText = "0s";
    if (callStartTime) {
        const diff = Date.now() - callStartTime;
        const minutes = Math.floor(diff / 60000);
        const seconds = Math.floor((diff % 60000) / 1000);
        if (minutes > 0) durationText = `${minutes}m ${seconds}s`;
        else durationText = `${seconds}s`;
    }

    endCallUI();
    hideIncomingCallUI();
    
    if (currentCallRef) currentCallRef.remove();
    
    if (shouldSaveLog && activeCallPartnerId && callStartTime) {
        saveCallLogToChat(activeCallPartnerId, durationText, isCurrentCallVideo);
    }

    peerConnection = null;
    localStream = null;
    currentCallRef = null;
    callStartTime = null;
    activeCallPartnerId = null;
}

function saveCallLogToChat(partnerId, duration, isVideo) {
    const uid1 = currentUser.uid;
    const uid2 = partnerId;
    const chatId = uid1 < uid2 ? `${uid1}_${uid2}` : `${uid2}_${uid1}`;

    const messageRef = db.ref(`messages/${chatId}`).push();
    
    messageRef.set({
        sender: currentUser.uid,
        type: 'call_log',
        message: 'Call ended',
        callDuration: duration,
        callType: isVideo ? 'video' : 'audio',
        timestamp: Date.now()
    });
}

// বাটন ইভেন্ট
const videoCallBtn = document.getElementById('header-video-call-btn');
const audioCallBtn = document.getElementById('header-audio-call-btn');
const modalVideoBtn = document.getElementById('modal-video-call-btn');
const modalAudioBtn = document.getElementById('modal-audio-call-btn');
const endCallBtn = document.getElementById('end-call-btn');
const rejectCallBtn = document.getElementById('reject-call-btn');

if(videoCallBtn) videoCallBtn.addEventListener('click', () => startCall(true));
if(audioCallBtn) audioCallBtn.addEventListener('click', () => startCall(false));

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

if(endCallBtn) endCallBtn.addEventListener('click', () => endCall(true));

if(rejectCallBtn) {
    rejectCallBtn.addEventListener('click', () => {
        hideIncomingCallUI();
        if(incomingCallData) {
            db.ref(`calls/${currentUser.uid}/${incomingCallData.key}`).remove();
        }
        activeCallPartnerId = null;
    });
}

// মাইক এবং ক্যামেরা টগল
const micToggleBtn = document.getElementById('mic-toggle-btn');
if (micToggleBtn) {
    micToggleBtn.addEventListener('click', () => {
        if (localStream) {
            const audioTrack = localStream.getAudioTracks()[0];
            if (audioTrack) {
                audioTrack.enabled = !audioTrack.enabled;
                micToggleBtn.style.background = audioTrack.enabled ? 'rgba(255,255,255,0.2)' : '#ff3b30';
            }
        }
    });
}

const camToggleBtn = document.getElementById('camera-toggle-btn');
if (camToggleBtn) {
    camToggleBtn.addEventListener('click', () => {
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