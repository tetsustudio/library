import { useTranslation } from '../../context.js'
import type { ProgressSyncStatus } from '../../hooks/use-reading-progress.js'

interface SyncStatusIndicatorProps {
  syncStatus: ProgressSyncStatus
  lastSyncedTime: Date | null
  positionText?: string | null
}

export const SyncStatusIndicator = ({ syncStatus, lastSyncedTime, positionText }: SyncStatusIndicatorProps) => {
  const { t } = useTranslation()

  // 'pending' existe para no mentir: antes decia "Sincronizado HH:MM:SS"
  // aunque hubiera posicion sin mandar, hasta dos minutos.
  const label = () => {
    switch (syncStatus) {
      case 'syncing':
        return t('syncing')
      case 'pending':
        return t('unsaved')
      case 'offline':
        return t('offlineLocal')
      case 'error':
        return t('syncError')
      case 'synced':
      default:
        if (!lastSyncedTime) return t('synced')
        {
        const time = lastSyncedTime.toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        })
        const base = `${t('synced')} ${time}`
        return positionText ? `${base} (${positionText})` : base
        }
    }
  }

  const dot =
    syncStatus === 'synced' ? 'bg-emerald-500' :
    syncStatus === 'syncing' ? 'bg-amber-500 animate-pulse' :
    syncStatus === 'pending' ? 'bg-amber-500' :
    syncStatus === 'offline' ? 'bg-slate-500' :
    'bg-rose-500'

  return (
    <div className="flex items-center gap-1.5 mt-0.5 text-[10px] text-slate-400 font-medium">
      <span className={`h-2 w-2 rounded-full ${dot}`} />
      <span>{label()}</span>
    </div>
  )
}
