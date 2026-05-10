(function () {
    const chatOverlay = document.getElementById('chatbot-overlay');
    const chatContainer = document.getElementById('chat-container');
    const chatInput = document.getElementById('chat-input');
    const sendBtn = document.getElementById('send-btn');
    const typingContainer = document.getElementById('typing-container');
    const resizeHandle = document.getElementById('chat-resize-handle');
    const disclaimer = document.getElementById('chat-disclaimer');
    const interactionBar = document.getElementById('chat-interaction-bar');
    const acceptBtn = document.getElementById('accept-chat-btn');

    function getCapacitorWindow() {
        try {
            if (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) {
                return window;
            }
            if (window.parent && window.parent.Capacitor && window.parent.Capacitor.isNativePlatform && window.parent.Capacitor.isNativePlatform()) {
                return window.parent;
            }
        } catch (e) {
            return null;
        }
        return null;
    }
    function isLocalhostServer() {
        return window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.hostname === APP_CONFIG.masjidName.toLowerCase() + '-app';
    }
    async function requestChatCompletion(messages) {
        const url = 'https://text.pollinations.ai/openai/chat/completions';
        const payload = { messages: messages };
        const capWindow = getCapacitorWindow();
        const capacitorHttp = capWindow && capWindow.Capacitor && capWindow.Capacitor.Plugins
            ? capWindow.Capacitor.Plugins.CapacitorHttp
            : null;

        if (isLocalhostServer() && capacitorHttp && typeof capacitorHttp.request === 'function') {
            const nativeResponse = await capacitorHttp.request({
                url: url,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                data: payload,
                connectTimeout: 20000,
                readTimeout: 30000
            });

            if (!nativeResponse || nativeResponse.status < 200 || nativeResponse.status >= 300) {
                throw new Error('Native HTTP response error');
            }

            if (typeof nativeResponse.data === 'string') {
                return JSON.parse(nativeResponse.data);
            }

            return nativeResponse.data;
        }

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            credentials: 'omit'
        });

        if (!response.ok) throw new Error('Network response error');
        return response.json();
    }

    if (!chatOverlay || !chatInput || !sendBtn) return;

    let chatHistory = [];
    const MAX_HISTORY = 20;

    // In-memory cache for static JSON assets to prevent repeated fetches and parsing
    const preloadedContext = {
        prayers: null,
        tajweed: null,
        azkar: null,
        masjids: null
    };

    async function fetchContextData(key, url) {
        if (preloadedContext[key] !== null) return preloadedContext[key];
        try {
            const res = await fetch(url);
            if (res.ok) {
                preloadedContext[key] = await res.json();
                return preloadedContext[key];
            }
        } catch (e) {
            console.warn(`Failed to preload ${url}`, e);
        }
        return null;
    }

    // Disclaimer Acceptance Logic
    if (sessionStorage.getItem('masjid_chatbot_accepted') === 'true') {
        if (disclaimer) disclaimer.style.display = 'none';
        if (interactionBar) interactionBar.style.display = 'flex';
    }

    if (acceptBtn) {
        acceptBtn.addEventListener('click', function () {
            sessionStorage.setItem('masjid_chatbot_accepted', 'true');
            if (disclaimer) {
                disclaimer.style.opacity = '0';
                disclaimer.style.visibility = 'hidden';
            }
            setTimeout(() => {
                if (disclaimer) disclaimer.style.display = 'none';
                if (interactionBar) {
                    interactionBar.style.display = 'flex';
                }
                if (chatInput) chatInput.focus();
            }, 300);
        });
    }

    // Global toggle function
    window.toggleChatbot = function () {
        const isActive = chatOverlay.classList.toggle('active');
        if (isActive) {
            chatContainer.scrollTop = chatContainer.scrollHeight;
            if (chatHint) chatHint.classList.remove('visible');
            setTimeout(() => chatInput.focus(), 300);
        }
    };

    // Chatbot Hints logic
    const chatHint = document.getElementById('chat-hint');
    const hints = [
        "Assalamu Alaikum! 👋",
        "Need help with prayer times?",
        "Ask about " + APP_CONFIG.masjidName + " events!",
        "When is Jumuah? Ask me!",
        "How can I help you today?",
        "Need the latest mosque news?",
        "Ask me anything about " + APP_CONFIG.masjidName + "!",
        "What is the Hijri date?",
        "Tell me about Tajweed rules.",
        "Find masjids nearby!"
    ];

    function showRandomHint() {
        if (!chatHint || chatOverlay.classList.contains('active')) return;

        const randomHint = hints[Math.floor(Math.random() * hints.length)];
        chatHint.textContent = randomHint;
        chatHint.classList.add('visible');

        setTimeout(() => {
            chatHint.classList.remove('visible');
        }, 6000);
    }

    // Initial hint after 3 seconds, then every 25 seconds
    let hintTimeout = setTimeout(showRandomHint, 3000);
    let hintInterval = setInterval(showRandomHint, 25000);

    // Cleanup intervals on page unload to prevent memory leaks in iframe context
    window.addEventListener('pagehide', function () {
        clearTimeout(hintTimeout);
        clearInterval(hintInterval);
    });

    // Draggable Logic
    let isDragging = false;
    let initialX, initialY, currentX = 0, currentY = 0, xOffset = 0, yOffset = 0;
    const chatHeader = chatOverlay.querySelector('.chat-header');

    if (chatHeader) {
        chatHeader.style.cursor = 'move';
        chatHeader.addEventListener('mousedown', dragStart);
        chatHeader.addEventListener('touchstart', dragStart, { passive: false });

        document.addEventListener('mousemove', drag);
        document.addEventListener('touchmove', drag, { passive: false });

        document.addEventListener('mouseup', dragEnd);
        document.addEventListener('touchend', dragEnd);

        // Clean up document-level drag listeners on page unload to prevent
        // memory leaks (closures hold references to chatbot DOM/state)
        window.addEventListener('pagehide', function () {
            document.removeEventListener('mousemove', drag);
            document.removeEventListener('touchmove', drag);
            document.removeEventListener('mouseup', dragEnd);
            document.removeEventListener('touchend', dragEnd);
        });
    }

    function dragStart(e) {
        if (e.type === "touchstart") {
            initialX = e.touches[0].clientX - xOffset;
            initialY = e.touches[0].clientY - yOffset;
        } else {
            initialX = e.clientX - xOffset;
            initialY = e.clientY - yOffset;
        }
        if (e.target === chatHeader || chatHeader.contains(e.target)) {
            isDragging = true;
        }
    }

    function drag(e) {
        if (isDragging) {
            if (e.cancelable) e.preventDefault();
            if (e.type === "touchmove") {
                currentX = e.touches[0].clientX - initialX;
                currentY = e.touches[0].clientY - initialY;
            } else {
                currentX = e.clientX - initialX;
                currentY = e.clientY - initialY;
            }
            xOffset = currentX;
            yOffset = currentY;
            // calc(-50% + currentX) to maintain the horizontal center start point
            chatOverlay.style.transform = `translate(calc(-50% + ${currentX}px), ${currentY}px)`;
        }
    }

    function dragEnd() {
        if (isDragging) {
            initialX = currentX;
            initialY = currentY;
            isDragging = false;
        }
    }

    // Auto-resize textarea
    chatInput.addEventListener('input', function () {
        this.style.height = 'auto';
        this.style.height = (this.scrollHeight) + 'px';
        if (this.value.trim() !== '') {
            sendBtn.disabled = false;
            sendBtn.style.opacity = '1';
        } else {
            sendBtn.disabled = true;
            sendBtn.style.opacity = '0.5';
        }
    });

    chatInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (!sendBtn.disabled) {
                sendMessage();
            }
        }
    });

    sendBtn.addEventListener('click', () => {
        if (!sendBtn.disabled) {
            sendMessage();
        }
    });

    function formatTime() {
        const now = new Date();
        let hours = now.getHours();
        let minutes = now.getMinutes();
        const ampm = hours >= 12 ? 'PM' : 'AM';
        hours = hours % 12;
        hours = hours ? hours : 12;
        minutes = minutes < 10 ? '0' + minutes : minutes;
        return hours + ':' + minutes + ' ' + ampm;
    }

    function simpleMarkdownToHtml(text) {
        let html = text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;')
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            .replace(/_(.*?)_/g, '<em>$1</em>')
            // Only allow http(s)/mailto/relative links; reject javascript:, data:, vbscript:
            // and any other scheme to prevent XSS via prompt injection or compromised AI service.
            // The URL is already HTML-escaped above (all of <,>,&,",') so it is attribute-safe.
            .replace(/\[([^\]]+)\]\(([^)]+)\)/g, function (_, label, url) {
                // Decode the entities we just added so we can run scheme validation on the original text
                const decoded = String(url)
                    .replace(/&#39;/g, "'")
                    .replace(/&quot;/g, '"')
                    .replace(/&gt;/g, '>')
                    .replace(/&lt;/g, '<')
                    .replace(/&amp;/g, '&')
                    .trim();
                const lower = decoded.toLowerCase();
                const isSafe = lower.startsWith('http://') ||
                    lower.startsWith('https://') ||
                    lower.startsWith('mailto:') ||
                    lower.startsWith('/') ||
                    lower.startsWith('#') ||
                    /^[a-z0-9._\-]+(?:\/|$)/i.test(decoded); // bare relative paths like example.com/x
                if (!isSafe) return label;
                return '<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + label + '</a>';
            });

        html = html.split(/\n\n+/).map(p => {
            if (p.trim().startsWith('- ') || p.trim().startsWith('* ')) {
                const lis = p.split(/\n/).map(line => {
                    const cleanLine = line.replace(/^[-*]\s+/, '');
                    return `<li>${cleanLine}</li>`;
                }).join('');
                return `<ul>${lis}</ul>`;
            }
            return `<p>${p.replace(/\n/g, '<br>')}</p>`;
        }).join('');

        return html;
    }

    function appendMessage(text, sender, isHtml = false) {
        if (!chatContainer) return;
        const messageDiv = document.createElement('div');
        messageDiv.className = `chat-message ${sender}`;

        const bubble = document.createElement('div');
        bubble.className = 'chat-bubble';

        if (sender === 'bot') {
            if (isHtml) {
                // Defense-in-depth: never inject raw HTML from remote/model output.
                // If a sanitizer utility exists globally, use it; otherwise fall back to plain text.
                if (typeof window.sanitizeHTML === 'function') {
                    bubble.innerHTML = window.sanitizeHTML(String(text || ''));
                } else {
                    bubble.textContent = String(text || '');
                }
            } else {
                bubble.innerHTML = simpleMarkdownToHtml(text);
            }
        } else {
            bubble.textContent = text;
        }

        const timeDiv = document.createElement('div');
        timeDiv.className = 'chat-time';
        timeDiv.textContent = formatTime();

        messageDiv.appendChild(bubble);
        messageDiv.appendChild(timeDiv);

        chatContainer.insertBefore(messageDiv, typingContainer);

        // Prevent DOM Memory Leak by capping visible messages to 40
        const messages = chatContainer.querySelectorAll('.chat-message');
        if (messages.length > 40) {
            chatContainer.removeChild(messages[0]);
        }

        chatContainer.scrollTop = chatContainer.scrollHeight;
    }

    // Cache the system prompt to avoid rebuilding it on every message
    let _cachedSystemPrompt = null;
    let _cachedSystemPromptTime = 0;
    const SYSTEM_PROMPT_CACHE_MS = 5 * 60 * 1000; // 5 minutes

    async function buildSystemPrompt() {
        const nowMs = Date.now();
        if (_cachedSystemPrompt && (nowMs - _cachedSystemPromptTime < SYSTEM_PROMPT_CACHE_MS)) {
            return _cachedSystemPrompt;
        }

        const now = new Date();
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(now.getDate() - 30);

        let systemPrompt = `You are a helpful, respectful, and friendly AI assistant for the ${APP_CONFIG.masjidFullTitle} (${APP_CONFIG.masjidName}). 
Your domain is specifically related to ${APP_CONFIG.masjidName} services, Islam, community updates, events, and prayer times. 
Provide short, concise, and helpful answers. 

[INSTRUCTION: Formatting]
- Do NOT use Markdown tables. Tables do not render well in the chat interface.
- Use bulleted lists or standard text blocks for structured data (like prayer times).
- Be concise and clear.

[${APP_CONFIG.masjidName} Location Information]
Address: ${APP_CONFIG.masjidAddress}
Coordinates: Latitude ${APP_CONFIG.masjidLat}, Longitude ${APP_CONFIG.masjidLng}
About ${APP_CONFIG.masjidName}: ${APP_CONFIG.masjidDescription}

[INSTRUCTION: Prayer Date Fallback]
I only have access to a rolling 30-day prayer schedule. 
If a user asks for a date outside the next 30 days, politely inform them of this limitation and direct them to the side menu:
"For the full annual timetable, please select 'Prayer Times Year' from the side menu in the app."

Current Date & Time: ${now.toUTCString().replace('GMT', '+0000')}
Timezone: ${APP_CONFIG.masjidTimeZone}\n\n`;

        // Include Masjid prayers data in the context
        try {
            const todayDetailedCache = localStorage.getItem('masjid_prayers_today');
            const notificationsCache = localStorage.getItem('masjid_notify_cache');
            const eventsCache = localStorage.getItem('masjid_events_cache');
            const postsCache = localStorage.getItem('masjid_posts_cache');

            // Include Detailed Today's Times (Iqamah & Jumuah)
            if (todayDetailedCache) {
                try {
                    const td = JSON.parse(todayDetailedCache);
                    const year = now.getFullYear();
                    const month = String(now.getMonth() + 1).padStart(2, '0');
                    const day = String(now.getDate()).padStart(2, '0');
                    const todayStr = `${year}-${month}-${day}`;

                    if (td.d_date === todayStr) {
                        systemPrompt += `[CONTEXT: Detailed Times for Today (${todayStr})]\n`;
                        if (td.hijri_date_convert) systemPrompt += `Hijri Date: ${td.hijri_date_convert}\n`;
                        systemPrompt += `Fajr: Begins ${td.fajr_begins}, Iqamah ${td.fajr_jamah}\n`;
                        systemPrompt += `Sunrise: ${td.sunrise}\n`;
                        systemPrompt += `Zuhr: Begins ${td.zuhr_begins}, Iqamah ${td.zuhr_jamah}\n`;
                        systemPrompt += `Asr: Begins ${td.asr_mithl_1 || td.asr_begins}, Iqamah ${td.asr_jamah}\n`;
                        systemPrompt += `Maghrib: Begins ${td.maghrib_begins}, Iqamah ${td.maghrib_jamah}\n`;
                        systemPrompt += `Isha: Begins ${td.isha_begins}, Iqamah ${td.isha_jamah}\n`;

                        if (td.jumuah && Array.isArray(td.jumuah) && td.jumuah.length > 0) {
                            const jLabels = td.jumuah.map(entry => {
                                // Support both new {time, label} format and legacy plain strings
                                if (typeof entry === 'object' && entry !== null) {
                                    const label = entry.label ? ` (${entry.label})` : '';
                                    return `${entry.time}${label}`;
                                }
                                return entry;
                            });
                            systemPrompt += `Jumuah Prayers: ${jLabels.join(' and ')}\n`;
                        }
                        systemPrompt += `\n`;
                    }

                    if (td.tomorrow) {
                        const tm = td.tomorrow;
                        systemPrompt += `[CONTEXT: Detailed Times for Tomorrow (${tm.d_date})]\n`;
                        if (tm.hijri_date_convert) systemPrompt += `Hijri Date: ${tm.hijri_date_convert}\n`;
                        systemPrompt += `Fajr: Begins ${tm.fajr_begins}, Iqamah ${tm.fajr_jamah}\n`;
                        systemPrompt += `Sunrise: ${tm.sunrise}\n`;
                        systemPrompt += `Zuhr: Begins ${tm.zuhr_begins}, Iqamah ${tm.zuhr_jamah}\n`;
                        systemPrompt += `Asr: Begins ${tm.asr_mithl_1 || tm.asr_begins}, Iqamah ${tm.asr_jamah}\n`;
                        systemPrompt += `Maghrib: Begins ${tm.maghrib_begins}, Iqamah ${tm.maghrib_jamah}\n`;
                        systemPrompt += `Isha: Begins ${tm.isha_begins}, Iqamah ${tm.isha_jamah}\n`;
                        systemPrompt += `\n`;
                    }
                } catch (e) { /* Ignore parse error */ }
            }

            // Include rolling 30-day prayer schedule
            const ptData = await fetchContextData('prayers', 'assets/data/prayers-schedule.json');
            if (ptData) {
                systemPrompt += `[CONTEXT: Prayer Schedule (Next 30 Days)]\n`;

                // Helper to detect timezone offset shift (Standard vs DST) for the masjid location
                const getDSTShift = (date) => {
                    try {
                        const tz = APP_CONFIG.masjidTimeZone || 'Europe/Dublin';
                        // Check at noon to avoid boundary issues during early morning transitions (1am/2am)
                        const checkDate = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0);
                        const getOffset = (dt) => {
                            const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' }).formatToParts(dt);
                            const offsetStr = parts.find(p => p.type === 'timeZoneName').value; // e.g. "GMT+01:00"
                            const match = offsetStr.match(/([+-])(\d{2}):(\d{2})/);
                            return match ? (match[1] === '+' ? 1 : -1) * parseInt(match[2]) : 0;
                        };
                        const stdOffset = Math.min(getOffset(new Date(date.getFullYear(), 0, 1)), getOffset(new Date(date.getFullYear(), 6, 1)));
                        return getOffset(checkDate) - stdOffset;
                    } catch (e) { return 0; }
                };

                const fmtTimeArr = (t, shift) => {
                    const h = (t[0] + shift + 24) % 24;
                    return `${h.toString().padStart(2, '0')}:${t[1].toString().padStart(2, '0')}`;
                };

                for (let i = 0; i < 30; i++) {
                    const d = new Date();
                    d.setDate(d.getDate() + i);
                    const year = d.getFullYear();
                    const month = d.getMonth() + 1;
                    const date = d.getDate();
                    const isLeap = (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
                    const sched = isLeap ? ptData.leap : ptData.standard;

                    if (sched && sched[month] && sched[month][date]) {
                        const t = sched[month][date];
                        const dateStr = d.toISOString().split('T')[0];
                        const shift = getDSTShift(d);
                        systemPrompt += `${dateStr}: Fajr:${fmtTimeArr(t[0], shift)}, Sun:${fmtTimeArr(t[1], shift)}, Dhuhr:${fmtTimeArr(t[2], shift)}, Asr:${fmtTimeArr(t[3], shift)}, Maghrib:${fmtTimeArr(t[4], shift)}, Isha:${fmtTimeArr(t[5], shift)}\n`;
                    }
                }
                systemPrompt += `\n`;
            }

            // Include Masjid masjidFeatures
            if (APP_CONFIG.masjidFeatures && APP_CONFIG.masjidFeatures.length > 0) {
                systemPrompt += `[CONTEXT: About ${APP_CONFIG.masjidName} / What We Do]\n`;
                APP_CONFIG.masjidFeatures.forEach(f => {
                    systemPrompt += `- ${f.title}: ${f.description}\n`;
                });
                systemPrompt += `\n`;
            }

            // Include Notifications context
            if (notificationsCache) {
                try {
                    const notificationsData = JSON.parse(notificationsCache);
                    const todayStr = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
                    const validNotify = notificationsData.filter(n =>
                        n.message && n.startDate && n.endDate &&
                        todayStr >= n.startDate && todayStr <= n.endDate &&
                        n['tv-only'] !== true
                    ).slice(-5).reverse();

                    if (validNotify.length > 0) {
                        systemPrompt += `[CONTEXT: Active App Notifications]\n`;
                        validNotify.forEach(n => {
                            systemPrompt += `- ${n.message.replace(/\n/g, ' ')}\n`;
                        });
                        systemPrompt += `\n`;
                    }
                } catch (e) { /* Ignore parse error */ }
            }

            // Include events context
            if (eventsCache) {
                try {
                    const eventsData = JSON.parse(eventsCache);
                    const futureEvents = eventsData.filter(e => new Date(e.start_date) >= now).sort((a, b) => new Date(a.start_date) - new Date(b.start_date)).slice(0, 5);
                    const pastEvents = eventsData.filter(e => {
                        const d = new Date(e.start_date);
                        return d < now && d >= thirtyDaysAgo;
                    }).sort((a, b) => new Date(b.start_date) - new Date(a.start_date)).slice(0, 3);

                    if (futureEvents.length > 0) {
                        systemPrompt += `[CONTEXT: Future ${APP_CONFIG.masjidName} Events]\n`;
                        futureEvents.forEach(e => {
                            systemPrompt += `- ${e.title} at ${new Date(e.start_date).toLocaleString()} (${e.url})\n`;
                        });
                        systemPrompt += `\n`;
                    } else {
                        systemPrompt += `[CONTEXT: Future ${APP_CONFIG.masjidName} Events]\nThere are no upcoming events scheduled at the moment.\n\n`;
                    }

                    if (pastEvents.length > 0) {
                        systemPrompt += `[CONTEXT: Past ${APP_CONFIG.masjidName} Events (Last 30 Days)]\n`;
                        pastEvents.forEach(e => {
                            systemPrompt += `- ${e.title} held on ${new Date(e.start_date).toLocaleString()} (${e.url})\n`;
                        });
                        systemPrompt += `\n`;
                    } else {
                        systemPrompt += `[CONTEXT: Past ${APP_CONFIG.masjidName} Events]\nThere are no past events recorded for the last 30 days.\n\n`;
                    }
                } catch (e) { /* Ignore parse error */ }
            } else {
                systemPrompt += `[CONTEXT: ${APP_CONFIG.masjidName} Events]\nThere is no event data available at the moment.\n\n`;
            }

            // Include posts context
            if (postsCache) {
                try {
                    const postsData = JSON.parse(postsCache);
                    const recent = postsData.filter(p => new Date(p.date) >= thirtyDaysAgo).slice(0, 5);

                    if (recent.length > 0) {
                        systemPrompt += `[CONTEXT: Recent ${APP_CONFIG.masjidName} Posts / News (Last 30 Days)]\n`;
                        const parser = new DOMParser();
                        recent.forEach(p => {
                            const cleanTitle = parser.parseFromString(p.title.rendered || '', 'text/html').body.textContent || '';
                            const cleanExcerpt = (parser.parseFromString(p.excerpt.rendered || '', 'text/html').body.textContent || '').trim().replace(/\s+/g, ' ').substring(0, 150) + '...';
                            systemPrompt += `- ${cleanTitle} (${new Date(p.date).toLocaleDateString()})\n  Brief: ${cleanExcerpt}\n  Link: ${p.link}\n`;
                        });
                        systemPrompt += `\n`;
                    } else {
                        systemPrompt += `[CONTEXT: Recent ${APP_CONFIG.masjidName} Posts]\nThere are no recent news posts from the last 30 days.\n\n`;
                    }
                } catch (e) { /* Ignore parse error */ }
            }

            // Include Tajweed rules context
            const tajData = await fetchContextData('tajweed', 'assets/data/tajweed-rules.json');
            if (tajData && Array.isArray(tajData) && tajData.length > 0) {
                systemPrompt += `[CONTEXT: Tajweed Rules for Quran Recitation]\n`;
                tajData.forEach(rule => {
                    systemPrompt += `- ${rule.title} (${rule.arTitle}): ${rule.description}\n`;
                });
                systemPrompt += `\n`;
            }

            // // Include Azkar categories (Not needed for now)
            // const azkRes = await fetch('assets/data/azkar.json').catch(() => null);
            // if (azkRes && azkRes.ok) {
            //     try {
            //         const azkData = await azkRes.json();
            //         if (azkData && azkData.categories) {
            //             systemPrompt += `[CONTEXT: Available Azkar Categories in App]\n`;
            //             azkData.categories.forEach(cat => {
            //                 systemPrompt += `- ${cat.title} (${cat.arabicTitle})\n`;
            //             });
            //             systemPrompt += `\n`;
            //         }
            //     } catch (e) { /* Ignore parse error */ }
            // }

            // Include Nearby Masjids context
            const masjidData = await fetchContextData('masjids', 'assets/data/nearby-masjids.json');
            if (masjidData && Array.isArray(masjidData) && masjidData.length > 0) {
                const categories = [...new Set(masjidData.map(m => m.category))];
                categories.forEach(cat => {
                    systemPrompt += `[CONTEXT: Nearby Masjids - ${cat}]\n`;
                    masjidData.filter(m => m.category === cat).forEach(m => {
                        systemPrompt += `- ${m.name}: ${m.address}\n`;
                        const pLink = m.prayer_times_api || m.prayer_times_url || m.prayer_times_page;
                        if (pLink) systemPrompt += `  Prayer Times: ${pLink}\n`;
                    });
                    systemPrompt += `\n`;
                });
            }

        } catch (err) {
            console.error('Error building context for AI:', err);
        }

        console.log("System Prompt:", systemPrompt);
        _cachedSystemPrompt = systemPrompt;
        _cachedSystemPromptTime = Date.now();
        return systemPrompt;
    }

    async function sendMessage() {
        const text = chatInput.value.trim();
        if (!text) return;

        chatInput.value = '';
        chatInput.style.height = 'auto';
        sendBtn.disabled = true;
        sendBtn.style.opacity = '0.5';

        appendMessage(text, 'user');

        chatHistory.push({ role: 'user', content: text });

        typingContainer.style.display = 'flex';
        chatContainer.appendChild(typingContainer);
        chatContainer.scrollTop = chatContainer.scrollHeight;

        try {
            const systemPromptContent = await buildSystemPrompt();

            const messages = [
                { role: 'system', content: systemPromptContent },
                ...chatHistory
            ];

            const data = await requestChatCompletion(messages);
            const responseText = data.choices[0].message.content;

            typingContainer.style.display = 'none';

            chatHistory.push({ role: 'assistant', content: responseText });
            if (chatHistory.length > MAX_HISTORY) {
                // Ensure we always start with the oldest message being a user (maintaining pairs is good but simple slice works for Pollinations)
                chatHistory = chatHistory.slice(-MAX_HISTORY);
            }
            appendMessage(responseText, 'bot');

        } catch (error) {
            console.error('AI Request Error:', error);
            if (typingContainer) typingContainer.style.display = 'none';
            appendMessage("I'm sorry, I'm having trouble connecting to the network right now. Please ensure you are online.", 'bot');
            chatHistory.pop();
        }
    }
})();
