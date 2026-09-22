document.addEventListener('DOMContentLoaded', () => {
    const opener = document.getElementById('opener');
    const openingVideo = document.getElementById('opening-video');
    const videoContainer = document.getElementById('video-container');
    const loader = document.getElementById('loader');
    const loaderLogo = document.getElementById('loader-logo');
    const loaderPercentage = document.getElementById('loader-percentage');
    const mainContainer = document.querySelector('.main-container');
    const body = document.querySelector('body');
    const hamburgerButton = document.getElementById('hamburger-button');
    const mobileNav = document.getElementById('mobile-nav');

    // --- Mobile Navigation ---
    if (hamburgerButton) {
        hamburgerButton.addEventListener('click', () => {
            hamburgerButton.classList.toggle('open');
            mobileNav.classList.toggle('open');
            body.classList.toggle('no-scroll');
        });
    }

    // --- Opening Animation ---
    function startLoader() {
        if(videoContainer) videoContainer.classList.add('hidden');
        if(loader) loader.classList.remove('hidden');

        let percent = 0;
        const interval = setInterval(() => {
            percent++;
            if (loaderLogo) loaderLogo.style.opacity = percent / 100;
            if (loaderPercentage) loaderPercentage.textContent = `${percent}%`;

            if (percent >= 100) {
                clearInterval(interval);
                setTimeout(revealCurtains, 500);
            }
        }, 25);
    }

    function revealCurtains() {
        if (opener) {
            opener.classList.add('revealed');
            setTimeout(() => {
                opener.style.display = 'none';
                if (mainContainer) mainContainer.classList.remove('hidden');
                body.classList.remove('no-scroll');
                startScrollAnimations();
            }, 1300); // Matches curtain transition time
        }
    }

    function startScrollAnimations() {
        const sections = document.querySelectorAll('.scroll-section');
        const imageObserver = new IntersectionObserver((entries, observer) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const image = entry.target;
                    image.classList.add('loaded');
                    observer.unobserve(image);
                }
            });
        }, { threshold: 0.15 });

        document.querySelectorAll('.lazy-image').forEach(img => imageObserver.observe(img));

        const sectionObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('visible');
                }
            });
        }, { threshold: 0.25 });

        sections.forEach(section => sectionObserver.observe(section));
    }

    // --- Page Initialization ---
    if (openingVideo) {
        openingVideo.addEventListener('ended', startLoader);
        body.classList.add('no-scroll');
    } else if (opener) {
        startLoader();
        body.classList.add('no-scroll');
    } else {
        if(mainContainer) mainContainer.classList.remove('hidden');
        if(body) body.classList.remove('no-scroll');
        startScrollAnimations();
    }

    // --- Reservation Form Handling ---
    const reservationForm = document.getElementById('reservation-form');
    if (reservationForm) {
        const formFeedback = document.getElementById('form-feedback');
        const submitButton = reservationForm.querySelector('button[type="submit"]');

        reservationForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            submitButton.disabled = true;
            submitButton.textContent = '送信中...';
            formFeedback.className = '';
            formFeedback.textContent = '';

            const formData = new FormData(reservationForm);
            const data = Object.fromEntries(formData.entries());

            try {
                const response = await fetch('/api/reservation', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(data),
                });

                if (response.ok) {
                    formFeedback.className = 'success';
                    formFeedback.textContent = 'ご予約リクエストを受け付けました。担当者からの連絡をお待ちください。';
                    reservationForm.reset();
                } else {
                    const result = await response.json();
                    throw new Error(result.error || 'サーバーエラーが発生しました。');
                }
            } catch (error) {
                formFeedback.className = 'error';
                formFeedback.textContent = `送信に失敗しました: ${error.message}`;
            } finally {
                submitButton.disabled = false;
                submitButton.textContent = '送信する';
            }
        });
    }
});