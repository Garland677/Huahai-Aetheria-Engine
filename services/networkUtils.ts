
// Helper for time fetching with multiple robust fallbacks
export const fetchNetworkTime = async (): Promise<number> => {
    const appendTimestamp = (url: string) => {
        const separator = url.includes('?') ? '&' : '?';
        return `${url}${separator}_t=${Date.now()}`;
    };

    const fetchWithTimeout = async (url: string, options: RequestInit = {}, timeout = 6000) => {
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), timeout);
        try {
            const res = await fetch(appendTimestamp(url), { ...options, signal: controller.signal });
            clearTimeout(id);
            return res;
        } catch (e) {
            clearTimeout(id);
            throw e;
        }
    };

    const strategies = [
        async () => {
            const res = await fetchWithTimeout('https://api.github.com', { method: 'HEAD' });
            const dateStr = res.headers.get('date');
            if (!dateStr) throw new Error('GitHub: No Date header');
            return new Date(dateStr).getTime();
        },
        async () => {
            const res = await fetchWithTimeout('https://cdn.jsdelivr.net/npm/react/package.json', { method: 'HEAD' });
            const dateStr = res.headers.get('date');
            if (!dateStr) throw new Error('jsDelivr: No Date header');
            return new Date(dateStr).getTime();
        },
        async () => {
            const res = await fetchWithTimeout('https://api.m.taobao.com/rest/api3.do?api=mtop.common.getTimestamp');
            if (!res.ok) throw new Error(`Taobao HTTP ${res.status}`);
            const json = await res.json();
            const t = json?.data?.t;
            if (!t) throw new Error('Taobao: Invalid data');
            return parseInt(t, 10);
        },
        async () => {
            const res = await fetchWithTimeout('https://unpkg.com/', { method: 'HEAD' });
            const dateStr = res.headers.get('date');
            if (!dateStr) throw new Error('Unpkg: No Date header');
            return new Date(dateStr).getTime();
        }
    ];

    return new Promise((resolve, reject) => {
        let failureCount = 0;
        const errors: string[] = [];
        let resolved = false;

        strategies.forEach(strategy => {
            strategy()
                .then(time => {
                    if (resolved) return;
                    if (time > 1704067200000) {
                        resolved = true;
                        resolve(time);
                    } else {
                        throw new Error(`Sanity check failed: ${time}`);
                    }
                })
                .catch(e => {
                    if (resolved) return;
                    failureCount++;
                    errors.push(e.message || String(e));
                    if (failureCount === strategies.length) {
                        reject(new Error(`验证服务器连接失败: 无可用的时间源。\n(Errors: ${errors.join('; ')})\n请检查网络连接。如使用代理，请尝试切换节点。`));
                    }
                });
        });
    });
};
