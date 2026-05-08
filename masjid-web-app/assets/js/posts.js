(function () {
    const POSTS_CACHE_KEY = 'masjid_posts_cache';
    const POSTS_TIMESTAMP_KEY = 'masjid_posts_cache_timestamp';
    const CACHE_TTL = 20 * 60 * 60 * 1000;

    const postsStatus = document.getElementById('posts-status');
    const postsList = document.getElementById('posts-list');

    const postModal = document.getElementById('post-modal');
    const modalImage = document.getElementById('modal-image');
    const modalTitle = document.getElementById('modal-title');
    const modalDescription = document.getElementById('modal-description');
    const modalMeta = document.getElementById('modal-meta');

    let allPostsData = [];

    // Reusable element for HTML entity decoding (avoids creating new elements per render)
    const tempDiv = document.createElement('div');

    // Validate that a URL is safe to use in CSS url() / href / src.
    // Rejects javascript:, vbscript:, and non-image data: URIs.
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

    window.openPostModal = function(postId) {
        // Force numeric id lookup to defend against onclick injection.
        const numericId = Number(postId);
        if (!Number.isFinite(numericId)) return;
        const post = allPostsData.find(p => Number(p.id) === numericId);
        if (!post) return;

        let imageUrl = '';
        if (post._embedded && post._embedded['wp:featuredmedia'] && post._embedded['wp:featuredmedia'][0]) {
            imageUrl = safeUrl(post._embedded['wp:featuredmedia'][0].source_url);
        }

        const date = formatDate(post.date);

        tempDiv.innerHTML = post.title.rendered || '';
        const titleText = tempDiv.textContent || tempDiv.innerText || '';

        if (imageUrl) {
            modalImage.src = imageUrl;
            modalImage.style.display = 'block';
        } else {
            modalImage.src = '';
            modalImage.style.display = 'none';
        }
        modalTitle.textContent = titleText;
        modalDescription.innerHTML = sanitizeHTML(post.content.rendered || 'No content available.');

        modalMeta.innerHTML = `<div class="post-info"><i class="mdi mdi-calendar"></i> <span>${escapeHTML(date)}</span></div>`;

        postModal.classList.add('active');
        document.body.style.overflow = 'hidden';
    };

    function renderPostHTML(post) {
        let imageUrl = null;
        if (post._embedded && post._embedded['wp:featuredmedia'] && post._embedded['wp:featuredmedia'][0]) {
            imageUrl = safeUrl(post._embedded['wp:featuredmedia'][0].source_url);
        }

        const date = formatDate(post.date);
        tempDiv.innerHTML = post.title.rendered || '';
        const titleText = tempDiv.textContent || tempDiv.innerText || '';

        tempDiv.innerHTML = post.excerpt.rendered || '';
        const excerptText = (tempDiv.textContent || tempDiv.innerText || '').trim();

        // Force numeric id; otherwise omit clickable link.
        const numericId = Number(post.id);
        const safeIdAttr = Number.isFinite(numericId) ? String(numericId) : '';

        const imageHtml = imageUrl
            ? `<div class="post-image" style="background-image: url('${escapeHTML(escapeForCssUrl(imageUrl))}')"></div>`
            : '';

        const linkHtml = safeIdAttr
            ? `<a href="javascript:void(0)" class="post-link" onclick="openPostModal(${safeIdAttr})">Read More <i class="mdi mdi-arrow-right"></i></a>`
            : '';

        return `
            <div class="post-card">
                ${imageHtml}
                <div class="post-details">
                    <h2 class="post-title">${escapeHTML(titleText)}</h2>
                    <div class="post-info"><i class="mdi mdi-calendar"></i> <span>${escapeHTML(date)}</span></div>
                    ${excerptText ? `<div class="post-excerpt">${escapeHTML(excerptText)}</div>` : ''}
                    ${linkHtml}
                </div>
            </div>`;
    }

    function renderPosts(posts) {
        allPostsData = posts;
        if (!posts || posts.length === 0) {
            postsStatus.innerHTML = `<div class="no-posts"><i class="mdi mdi-newspaper-variant-outline"></i><p>No recent news found.</p></div>`;
            return;
        }

        postsList.innerHTML = posts.map(renderPostHTML).join('');
        postsStatus.style.display = 'none';
        postsList.style.display = 'block';
    }

    async function fetchPosts() {
        const threeMonthsAgo = new Date();
        threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
        const afterParam = threeMonthsAgo.toISOString().split('.')[0];
        const apiURL = `${APP_CONFIG.postsPath}?per_page=12&after=${afterParam}&_embed`;

        try {
            const response = await fetch(apiURL);
            const data = await response.json();
            if (data && Array.isArray(data)) {
                localStorage.setItem(POSTS_CACHE_KEY, JSON.stringify(data));
                localStorage.setItem(POSTS_TIMESTAMP_KEY, Date.now().toString());
                renderPosts(data);
            } else {
                renderPosts([]);
            }
        } catch (error) {
            console.error('Failed to fetch posts:', error);
            const cached = localStorage.getItem(POSTS_CACHE_KEY);
            if (cached) {
                try {
                    renderPosts(JSON.parse(cached));
                } catch (parseErr) {
                    // Corrupt cache — clear it and show error
                    localStorage.removeItem(POSTS_CACHE_KEY);
                    localStorage.removeItem(POSTS_TIMESTAMP_KEY);
                    postsStatus.innerHTML = `<div class="no-posts"><i class="mdi mdi-alert-circle-outline"></i><p>Error loading news.</p></div>`;
                }
            } else {
                postsStatus.innerHTML = `<div class="no-posts"><i class="mdi mdi-alert-circle-outline"></i><p>Error loading news.</p></div>`;
            }
        }
    }

    function init() {
        const cached = localStorage.getItem(POSTS_CACHE_KEY);
        const cacheTime = localStorage.getItem(POSTS_TIMESTAMP_KEY);
        if (cached && cacheTime && (Date.now() - parseInt(cacheTime) < CACHE_TTL)) {
            try {
                renderPosts(JSON.parse(cached));
            } catch (e) {
                // Corrupt cache — clear and fetch fresh
                localStorage.removeItem(POSTS_CACHE_KEY);
                localStorage.removeItem(POSTS_TIMESTAMP_KEY);
                fetchPosts();
            }
        } else {
            fetchPosts();
        }
    }

    init();
})();
