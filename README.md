# Филимонова

Веб-приложение ПТО.

## Архитектура
- GitHub Pages — статический frontend.
- Supabase Auth — пользователи.
- Supabase PostgreSQL — рабочие данные.
- Supabase Storage — документы.

Репозиторий публичный, поэтому реальные данные объекта, исходные Excel/PDF, резервные копии JSON и секретные ключи сюда не загружаются.

В браузерном frontend допускаются только Supabase Project URL и publishable key. Service role key здесь хранить запрещено.
