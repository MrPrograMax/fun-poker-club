Until Morning — первый пилотный релиз для домашних покерных турниров и кэша на одном устройстве.

## Скачать и запустить

| Система | Скачать | Запуск |
| --- | --- | --- |
| Windows · Intel / AMD | [Приложение .exe](https://github.com/MrPrograMax/fun-poker-club/releases/download/{{tag}}/until-morning-{{tag}}-windows-amd64.exe) | Откройте скачанный файл |
| macOS · Apple Silicon и Intel | [Установщик .pkg](https://github.com/MrPrograMax/fun-poker-club/releases/download/{{tag}}/until-morning-{{tag}}-macos-universal.pkg) | Установите и откройте Until Morning из «Программы» |
| Linux · Intel / AMD | [Приложение .run](https://github.com/MrPrograMax/fun-poker-club/releases/download/{{tag}}/until-morning-{{tag}}-linux-amd64.run) | Разрешите исполнение файла и запустите его |

Для устройств ARM: [Windows ARM64](https://github.com/MrPrograMax/fun-poker-club/releases/download/{{tag}}/until-morning-{{tag}}-windows-arm64.exe) · [Linux ARM64](https://github.com/MrPrograMax/fun-poker-club/releases/download/{{tag}}/until-morning-{{tag}}-linux-arm64.run).

Браузер открывается автоматически. Go, Node.js и Docker не нужны. На Windows/Linux оставьте окно программы открытым во время игры; остановка — Ctrl+C или закрытие окна. На macOS — меню Until Morning → «Завершить» (⌘Q). Закрытие вкладки браузера само по себе сервер не останавливает.

Linux, если запуск через файловый менеджер недоступен:

```sh
chmod +x until-morning-{{tag}}-linux-amd64.run
./until-morning-{{tag}}-linux-amd64.run
```

Сборки пока без подписи доверенного издателя. При первом запуске Windows/macOS могут запросить разрешение. На macOS оно доступно в «Системные настройки → Конфиденциальность и безопасность» после попытки открыть установщик.

## Сохранения и обновление

Прямые загрузки хранят игры в постоянной папке пользователя:

- Windows: `%LOCALAPPDATA%\Until Morning`
- macOS: `~/Library/Application Support/Until Morning` (также доступна из меню приложения).
- Linux: `$XDG_DATA_HOME/until-morning` или `~/.local/share/until-morning`.

При первом запуске `.exe`/`.run` старая папка `data` рядом с файлом автоматически копируется, если постоянной папки ещё нет. Исходные файлы сохраняются. При переходе с ZIP на macOS закройте старую версию и перенесите содержимое `data` в папку выше. Если там уже есть игры, сначала сделайте резервную копию: каталоги не объединяются автоматически.

ZIP-архивы оставлены как переносной вариант: распакуйте целиком и используйте `start.cmd`, `start.command` или `start.sh`. Они сохраняют игры в `data` рядом с запускатором. SHA-256 каждого файла доступен прямо в Assets. **Source code** — исходники, готовые приложения находятся по ссылкам выше.

## Возможности

Таймер и структура блайндов, перерывы, МТТ и балансировка столов, поздняя регистрация, ре-энтри и аддоны, фиксированное и прогрессивное баунти, выплаты, отмена действий и архив игр.

Экспорт JSON содержит имя/ФИО и ник отдельными первыми полями (`schemaVersion: 2`), затем место, взносы, статистику и выплаты. Отсутствующее имя или ник — `null`, без подстановки «Игрок N».

Управление с другого устройства пока не реализовано. Методика стресс-проверок — в [отчёте](https://github.com/MrPrograMax/fun-poker-club/blob/{{tag}}/docs/stress-test-2026-11-09.md).
