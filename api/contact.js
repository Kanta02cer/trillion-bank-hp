document.addEventListener('DOMContentLoaded', function () {
    const form = document.getElementById('contact-form');
    const thankYouMessage = document.getElementById('thank-you-message');
    const submitButton = form.querySelector('button[type="submit"]');
    const purposeSelect = document.getElementById('purpose');
    const purposeLabel = document.querySelector('label[for="purpose"]');

    if (purposeSelect && purposeLabel) {
        // Hide label on selection
        purposeSelect.addEventListener('change', function() {
            purposeLabel.style.display = 'none';
        });

        // Also check on page load in case of browser auto-fill
        if (purposeSelect.value) {
            purposeLabel.style.display = 'none';
        }
    }

    if (form) {
        form.addEventListener('submit', function (e) {
            e.preventDefault();

            const formData = new FormData(form);

            // ── AI流入データをフォームに自動付加 ──────────────────
            // RegalisAI トラッキングAPIが利用可能な場合
            if (window.RegalisAI && typeof window.RegalisAI.enrichFormData === 'function') {
                window.RegalisAI.enrichFormData(formData);
            } else {
                // フォールバック: localStorageから直接取得
                try {
                    var aiAttr = JSON.parse(localStorage.getItem('regalis_ai_attr') || 'null');
                    if (aiAttr) {
                        formData.append('ai_source', aiAttr.source || '');
                        formData.append('ai_channel', aiAttr.channel || '');
                        formData.append('ai_landing', aiAttr.landing_page || '');
                        formData.append('ai_session', aiAttr.session_id || '');
                    }
                } catch(e) {}
            }
            // 現在のページパスをソースに追加
            formData.append('page_path', window.location.pathname);

            const originalButtonText = submitButton.innerHTML;

            // Disable button and show submitting state
            submitButton.disabled = true;
            submitButton.innerHTML = '送信中...';

            fetch(form.action, {
                method: 'POST',
                body: formData,
                headers: {
                    'Accept': 'application/json'
                }
            }).then(response => {
                if (response.ok) {
                    // Success
                    form.style.display = 'none';
                    thankYouMessage.classList.remove('hidden');
                } else {
                    // Error
                    response.json().then(data => {
                        if (Object.hasOwn(data, 'errors')) {
                            alert(data["errors"].map(error => error["message"]).join(", "));
                        } else {
                            alert('フォームの送信に失敗しました。もう一度お試しください。');
                        }
                        // Restore button
                        submitButton.disabled = false;
                        submitButton.innerHTML = originalButtonText;
                    })
                }
            }).catch(error => {
                // Network error
                alert('フォームの送信に失敗しました。ネットワーク接続を確認してください。');
                // Restore button
                submitButton.disabled = false;
                submitButton.innerHTML = originalButtonText;
            });
        });
    }
});