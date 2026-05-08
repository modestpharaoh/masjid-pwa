(function () {
    const EVENTS_CACHE_KEY = 'masjid_events_cache';
    const EVENTS_TIMESTAMP_KEY = 'masjid_events_cache_timestamp';
    const CACHE_TTL = 20 * 60 * 60 * 1000;

    const eventsStatus = document.getElementById('events-status');
    const upcomingList = document.getElementById('upcoming-list');
    const upcomingSection = document.getElementById('upcoming-section');
    const pastList = document.getElementById('past-list');
    const pastSection = document.getElementById('past-section');

    const eventModal = document.getElementById('event-modal');
    const modalImage = document.getElementById('modal-image');
    const modalTitle = document.getElementById('modal-title');
    const modalDescription = document.getElementById('modal-description');
    const modalMeta = document.getElementById('modal-meta');

    let allEventsData = [];

    // Reusable element for HTML content extraction (avoids creating new elements per render)
    const tempDiv = document.createElement('div');

    // Validate that a URL is safe to use in CSS url() / href / src.
    // Rejects javascript:, vbscript:, and non-image data: URIs. Returns '' if unsafe.
    function safeUrl(raw) {
        if (!raw || typeof raw !== 'string') return '';
        const url = raw.trim();
        if (!url) return '';
        const lower = url.toLowerCase();
        if (lower.startsWith('javascript:') || lower.startsWith('vbscript:')) return '';
        if (lower.startsWith('data:') && !lower.startsWith('data:image/')) return '';
        return url;
    }

    // Escape characters that could break out of CSS url('...') context.
    function escapeForCssUrl(url) {
        return String(url).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\A ');
    }

    window.openEventModal = function(eventId) {
        // Force numeric id lookup to defend against onclick injection.
        const numericId = Number(eventId);
        if (!Number.isFinite(numericId)) return;
        const event = allEventsData.find(e => Number(e.id) === numericId);
        if (!event) return;

        const imageUrl = safeUrl(event.image && event.image.url);
        const startDate = formatDate(event.start_date, true);
        const startTime = formatTime(event.start_date);
        const endTime = formatTime(event.end_date);

        if (imageUrl) {
            modalImage.src = imageUrl;
            modalImage.style.display = 'block';
        } else {
            modalImage.src = '';
            modalImage.style.display = 'none';
        }
        modalTitle.textContent = event.title;
        modalDescription.innerHTML = sanitizeHTML(event.description || 'No description available.');

        let metaHtml = `
            <div class="event-info"><i class="mdi mdi-calendar"></i> <span>${escapeHTML(startDate)}</span></div>
            <div class="event-info"><i class="mdi mdi-clock-outline"></i> <span>${escapeHTML(startTime)} - ${escapeHTML(endTime)}</span></div>
        `;
        if (event.venue && event.venue.venue) {
            metaHtml += `<div class="event-info"><i class="mdi mdi-map-marker"></i> <span>${escapeHTML(event.venue.venue)}</span></div>`;
        }
        modalMeta.innerHTML = metaHtml;

        eventModal.classList.add('active');
        document.body.style.overflow = 'hidden';
    };

    function renderEventHTML(event) {
        const imageUrl = safeUrl(event.image && event.image.url);
        const startDate = formatDate(event.start_date);
        const startTime = formatTime(event.start_date);

        tempDiv.innerHTML = event.description || '';
        const textContent = (tempDiv.textContent || tempDiv.innerText || '').trim();

        // Force numeric event id; if somehow non-numeric, render no clickable link.
        const numericId = Number(event.id);
        const safeIdAttr = Number.isFinite(numericId) ? String(numericId) : '';

        const imageHtml = imageUrl
            ? `<div class="event-image" style="background-image: url('${escapeHTML(escapeForCssUrl(imageUrl))}')"></div>`
            : '';

        const linkHtml = safeIdAttr
            ? `<a href="javascript:void(0)" class="event-link" onclick="openEventModal(${safeIdAttr})">Read More <i class="mdi mdi-arrow-right"></i></a>`
            : '';

        return `
            <div class="event-card">
                ${imageHtml}
                <div class="event-details">
                    <h2 class="event-title">${escapeHTML(event.title)}</h2>
                    <div class="event-info"><i class="mdi mdi-calendar"></i> <span>${escapeHTML(startDate)}</span></div>
                    <div class="event-info"><i class="mdi mdi-clock-outline"></i> <span>${escapeHTML(startTime)}</span></div>
                    ${textContent ? `<div class="event-excerpt">${escapeHTML(textContent)}</div>` : ''}
                    ${linkHtml}
                </div>
            </div>`;
    }

    function processAndRenderEvents(allEvents) {
        allEventsData = allEvents;
        if (!allEvents || allEvents.length === 0) {
            eventsStatus.innerHTML = `<div class="no-events"><i class="mdi mdi-calendar-blank-outline"></i><p>No events found.</p></div>`;
            return;
        }

        const now = new Date();
        const upcoming = allEvents.filter(e => new Date(e.start_date) >= now).sort((a,b) => new Date(a.start_date) - new Date(b.start_date));
        const past = allEvents.filter(e => new Date(e.start_date) < now).sort((a,b) => new Date(b.start_date) - new Date(a.start_date));

        if (upcoming.length > 0) {
            upcomingList.innerHTML = upcoming.map(renderEventHTML).join('');
            upcomingSection.style.display = 'block';
        } else {
            upcomingSection.style.display = 'none';
        }

        if (past.length > 0) {
            pastList.innerHTML = past.map(renderEventHTML).join('');
            pastSection.style.display = 'block';
        } else {
            pastSection.style.display = 'none';
        }

        eventsStatus.style.display = 'none';
        if (upcoming.length === 0 && past.length === 0) {
            eventsStatus.style.display = 'block';
            eventsStatus.innerHTML = '<div class="no-events"><p>No events available.</p></div>';
        }
    }

    async function fetchEvents() {
        const oneMonthAgo = new Date();
        oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 6);
        const apiURL = `${APP_CONFIG.eventsPath}?per_page=15&start_date=${oneMonthAgo.toISOString().split('T')[0]}`;

        try {
            const response = await fetch(apiURL);
            const data = await response.json();
            if (data && data.events) {
                localStorage.setItem(EVENTS_CACHE_KEY, JSON.stringify(data.events));
                localStorage.setItem(EVENTS_TIMESTAMP_KEY, Date.now().toString());
                processAndRenderEvents(data.events);
            } else {
                processAndRenderEvents([]);
            }
        } catch (error) {
            console.error('Failed to fetch events:', error);
            const cached = localStorage.getItem(EVENTS_CACHE_KEY);
            if (cached) {
                try {
                    processAndRenderEvents(JSON.parse(cached));
                } catch (parseErr) {
                    // Corrupt cache — clear it and show error
                    localStorage.removeItem(EVENTS_CACHE_KEY);
                    localStorage.removeItem(EVENTS_TIMESTAMP_KEY);
                    eventsStatus.innerHTML = `<div class="no-events"><i class="mdi mdi-alert-circle-outline"></i><p>Error loading events.</p></div>`;
                }
            } else {
                eventsStatus.innerHTML = `<div class="no-events"><i class="mdi mdi-alert-circle-outline"></i><p>Error loading events.</p></div>`;
            }
        }
    }

    function init() {
        const cached = localStorage.getItem(EVENTS_CACHE_KEY);
        const cacheTime = localStorage.getItem(EVENTS_TIMESTAMP_KEY);
        if (cached && cacheTime && (Date.now() - parseInt(cacheTime) < CACHE_TTL)) {
            try {
                processAndRenderEvents(JSON.parse(cached));
            } catch (e) {
                // Corrupt cache — clear and fetch fresh
                localStorage.removeItem(EVENTS_CACHE_KEY);
                localStorage.removeItem(EVENTS_TIMESTAMP_KEY);
                fetchEvents();
            }
        } else {
            fetchEvents();
        }
    }

    init();
})();
