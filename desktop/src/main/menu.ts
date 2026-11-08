import { app, BrowserWindow, Menu, shell, type MenuItemConstructorOptions } from 'electron'
import type { MenuCommand } from '../shared/types'
import { BRAND } from '../shared/brand'
import { paths } from './paths'

/** Native menu in the user's language; commands are forwarded to the renderer. */
export function buildMenu(win: BrowserWindow, locale: 'ar' | 'en'): void {
  const ar = locale === 'ar'
  const send = (command: MenuCommand) => () => win.webContents.send('menu:command', command)
  const t = (a: string, e: string) => (ar ? a : e)

  const template: MenuItemConstructorOptions[] = [
    {
      label: t('ملف', 'File'),
      submenu: [
        { label: t('مستند جديد', 'New document'), accelerator: 'F2', click: send('new-document') },
        { label: t('طباعة', 'Print'), accelerator: 'CmdOrCtrl+P', click: send('print') },
        { type: 'separator' },
        { label: t('تبديل الشركة', 'Switch company'), accelerator: 'CmdOrCtrl+Shift+O', click: send('switch-company') },
        { label: t('نسخة احتياطية الآن', 'Back up now'), accelerator: 'CmdOrCtrl+Shift+B', click: send('backup-now') },
        { label: t('قفل الشاشة', 'Lock screen'), accelerator: 'CmdOrCtrl+L', click: send('lock') },
        { type: 'separator' },
        { label: t('التفضيلات', 'Preferences'), accelerator: 'CmdOrCtrl+,', click: send('preferences') },
        { type: 'separator' },
        { label: t('خروج', 'Quit'), role: 'quit' },
      ],
    },
    {
      label: t('تحرير', 'Edit'),
      submenu: [
        { label: t('تراجع', 'Undo'), role: 'undo' },
        { label: t('إعادة', 'Redo'), role: 'redo' },
        { type: 'separator' },
        { label: t('قص', 'Cut'), role: 'cut' },
        { label: t('نسخ', 'Copy'), role: 'copy' },
        { label: t('لصق', 'Paste'), role: 'paste' },
        { label: t('تحديد الكل', 'Select all'), role: 'selectAll' },
        { type: 'separator' },
        { label: t('البحث السريع', 'Command palette'), accelerator: 'CmdOrCtrl+K', click: send('command-palette') },
      ],
    },
    {
      label: t('عرض', 'View'),
      submenu: [
        { label: t('إعادة تحميل', 'Reload'), role: 'reload' },
        { label: t('تكبير', 'Zoom in'), role: 'zoomIn' },
        { label: t('تصغير', 'Zoom out'), role: 'zoomOut' },
        { label: t('الحجم الطبيعي', 'Actual size'), role: 'resetZoom' },
        { type: 'separator' },
        { label: t('ملء الشاشة', 'Full screen'), role: 'togglefullscreen' },
        ...(paths.isDev ? [{ label: 'DevTools', role: 'toggleDevTools' } as MenuItemConstructorOptions] : []),
      ],
    },
    {
      label: t('مساعدة', 'Help'),
      submenu: [
        { label: t('حول البرنامج', `About ${BRAND.name}`), click: send('about') },
        { label: t('مجلد السجلات', 'Open logs folder'), click: () => void shell.openPath(paths.logs()) },
        { label: t('مجلد البيانات', 'Open data folder'), click: () => void shell.openPath(paths.userData()) },
        { type: 'separator' },
        { label: `${BRAND.name} ${app.getVersion()}`, enabled: false },
      ],
    },
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
