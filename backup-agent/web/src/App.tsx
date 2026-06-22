import React, { useState, useEffect, useRef, Fragment } from 'react';
import { 
  Shield, 
  LayoutDashboard, 
  CloudLightning, 
  Download, 
  Settings, 
  CheckCircle, 
  Key, 
  FileCode, 
  FolderSync, 
  HelpCircle,
  Upload,
  Lock,
  RefreshCw,
  Trash2,
  Database,
  Cloud,
  Layers,
  Search,
  ArrowUpDown,
  AlertTriangle,
  FileCheck,
  ListTodo,
  Globe
} from 'lucide-react';

const DESTINATION_GUIDES = {
  telegram: {
    title: "Telegram Bot备份指引",
    steps: [
      "打开 Telegram 并搜索官方机器人 @BotFather，关注后发送指令 `/newbot`。",
      "按照提示输入您的 Bot 昵称和用户名，创建成功后复制生成的 `Bot API Token`。",
      "新建一个 Telegram 私有频道 (Channel) 并将刚才创建的 Bot 添加为管理员（赋予发送消息权限）。",
      "在频道中随便发送一条测试消息，随后在浏览器中访问：`https://api.telegram.org/bot<您的Token>/getUpdates`，在返回的 JSON 中找到 `\"chat\":{\"id\": -100xxxxxxxx}`，这串以 -100 开头的负数即为您的 `Chat ID`。"
    ]
  },
  onedrive: {
    title: "OneDrive 异地加密盘指引",
    steps: [
      "在您的本地 Windows 电脑上下载并安装 Rclone (https://rclone.org/downloads)。",
      "在本地命令行中执行 `rclone config`，新建一个 Remote 并选择类型为 `onedrive`，根据命令行提示完成微软账号 OAuth 扫码授权。",
      "完成授权后，新建一个类型为 `crypt` 的加密虚拟盘包装器，将目标指向您刚才配置好的 `onedrive:backup/encrypted`，并设置两层混淆密码。",
      "授权配置全部保存在您本地电脑的 `%USERPROFILE%/.config/rclone/rclone.conf` 配置文件中。将该文件的内容直接拖拽或复制上传到右侧表单中，控制台便会自动完成 VPS 的无缝对接！"
    ]
  },
  gdrive: {
    title: "Google Drive 异地加密盘指引",
    steps: [
      "与 OneDrive 类似，最稳定的方式是在您本地电脑上运行 `rclone config` 完成项目初始化。",
      "在本地 Rclone 新建一个类型为 `drive` 的远端，在提示 `Use auto config?` 时选择 `Yes` 以自动拉起浏览器，登录您的谷歌账号并同意 API 授权。",
      "完成授权后，为了您的绝对隐私，同样建议新建一个类型为 `crypt` 的加密远端，将路径映射为 `gdrive:backup/encrypted`。",
      "最后将您本地生成的 `rclone.conf` 内容上传至右侧即可。所有 Token 的刷新机制会自动在 VPS 上静默运行，无需人工干预。"
    ]
  },
  pikpak: {
    title: "PikPak 原生存储同步指引",
    steps: [
      "PikPak 提供了极大的云端存储容量，备份到 PikPak 现已全面使用 Rclone 的原生 PikPak 驱动进行对接，连接更稳定高速。",
      "您只需要在右侧输入您的 PikPak 登录账号（手机号或邮箱）及密码。API 代理地址为可选填，直接使用官方原生 API 可保持为空。",
      "控制面板会自动创建 PikPak 的原生远程配置，并自动在其上建立 `crypt` 加密壳，实现文件流在上传前在本地内存强加密打包，实现零泄密风险。"
    ]
  }
};

function App() {
  const ITEM_HEIGHT = 22;
  const BUFFER = 10;
  const [activeTab, setActiveTab] = useState<'dashboard' | 'destinations' | 'settings'>('dashboard');
  const [activeDest, setActiveDest] = useState<'telegram' | 'onedrive' | 'gdrive' | 'pikpak'>('telegram');

  // OAuth 授权对话框相关的 State
  const [showOAuthModal, setShowOAuthModal] = useState(false);
  const [oauthUrls, setOauthUrls] = useState({ auto_url: '', manual_url: '' });
  const [manualCode, setManualCode] = useState('');
  const [oauthLoading, setOauthLoading] = useState(false);
  const [oauthSubmitLoading, setOauthSubmitLoading] = useState(false);

  // ==============================================================================
  // 配置参数与状态变量
  // ==============================================================================
  const [tasks, setTasks] = useState<any[]>([]);
  const [taskHistoryLimit, setTaskHistoryLimit] = useState(50);
  const [logKeepDays, setLogKeepDays] = useState(365);
  const [selectedExportCategories, setSelectedExportCategories] = useState<string[]>([
    'rclone', 'local_pull_manifest', 'backup_password', 'custom_paths', 
    'gfs_backup_rules', 'system_settings', 'task_history_logs', 'server_backup_list'
  ]);

  const [isHistoryCollapsed, setIsHistoryCollapsed] = useState(true);
  const [localPullLogs, setLocalPullLogs] = useState<any[]>([]);
  const [isPullLogsCollapsed, setIsPullLogsCollapsed] = useState(true);
  const [showToken, setShowToken] = useState(false);
  const [expandedTaskIds, setExpandedTaskIds] = useState<Record<string, boolean>>({});

  const toggleTaskExpand = (taskId: string) => {
    setExpandedTaskIds(prev => ({
      ...prev,
      [taskId]: !prev[taskId]
    }));
  };
  const [isToolboxCollapsed, setIsToolboxCollapsed] = useState(true);

  const [tgToken, setTgToken] = useState('your_telegram_bot_token_here');
  const [tgApiUrl, setTgApiUrl] = useState('https://api.telegram.org');
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [labels, setLabels] = useState<{[key: string]: string}>({});
  const [filterKeepOnly, setFilterKeepOnly] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importModules, setImportModules] = useState<any>(null);
  const [selectedImportModules, setSelectedImportModules] = useState<string[]>([]);

  const [tgChatId, setTgChatId] = useState('your_telegram_chat_id_here');
  const [backupPass, setBackupPass] = useState('your_backup_passphrase_here');
  
  // 定时周期解耦
  const [cronHoursDB, setCronHoursDB] = useState('1');
  const [cronHoursSys, setCronHoursSys] = useState('24');

  // 各个存储池的 GFS 保留规则
  const [localDBRule, setLocalDBRule] = useState('H:24h; D:7d; W:30d; M:180d; Y:forever');
  const [localSysRule, setLocalSysRule] = useState('D:7d; W:30d; M:180d; Y:forever');
  const [telegramDBRule, setTelegramDBRule] = useState('forever');
  const [telegramSysRule, setTelegramSysRule] = useState('forever');
  const [onedriveDBRule, setOneDriveDBRule] = useState('H:24h; D:30d; W:90d; M:365d; Y:forever');
  const [onedriveSysRule, setOneDriveSysRule] = useState('D:30d; W:90d; M:365d; Y:forever');
  const [gdriveDBRule, setGDriveDBRule] = useState('H:24h; D:30d; W:90d; M:365d; Y:forever');
  const [gdriveSysRule, setGDriveSysRule] = useState('D:30d; W:90d; M:365d; Y:forever');
  const [pikpakDBRule, setPikpakDBRule] = useState('H:24h; D:30d; W:90d; M:365d; Y:forever');
  const [pikpakSysRule, setPikpakSysRule] = useState('D:30d; W:90d; M:365d; Y:forever');

  // 新增：本地客户端冷备拉取 GFS 规则
  const [localPullDBRule, setLocalPullDBRule] = useState('H:24h; D:7d; W:30d; M:180d; Y:forever');
  const [localPullSysRule, setLocalPullSysRule] = useState('D:7d; W:30d; M:180d; Y:forever');

  // 本地拉取及 PikPak
  const [localPullPath, setLocalPullPath] = useState(`D:\\Backup\\VPS_Backup`);
  const [pikpakURL, setPikpakURL] = useState('');
  const [pikpakUser, setPikpakUser] = useState('');
  const [pikpakPass, setPikpakPass] = useState('');

  const [customPathsText, setCustomPathsText] = useState('');
  const [systemBackupMode, setSystemBackupMode] = useState('full_inc');
  const [useRcloneCrypt, setUseRcloneCrypt] = useState(false);
  const [bootstrapCmd, setBootstrapCmd] = useState('正在生成一键部署指令，请稍候...');

  // 仪表盘指标数据与定时器下次备份状态
  const [lastBackupTime, setLastBackupTime] = useState('加载中...');
  const [snapshotCount, setSnapshotCount] = useState(0);
  const [assetFileCount, setAssetFileCount] = useState(2);
  const [telegramStatus, setTelegramStatus] = useState('unconfigured');
  const [onedriveStatus, setOnedriveStatus] = useState('unconfigured');
  const [gdriveStatus, setGdriveStatus] = useState('unconfigured');
  const [pikpakStatus, setPikpakStatus] = useState('unconfigured');
  const [downloadToken, setDownloadToken] = useState('');
  const [healthReport, setHealthReport] = useState<any>(null);

  // 新增：用于仪表盘渲染的详细任务近况和计划
  const [dbNextTime, setDbNextTime] = useState<number>(0);
  const [dbLastStartTime, setDbLastStartTime] = useState<number>(0);
  const [dbLastEndTime, setDbLastEndTime] = useState<number>(0);
  const [dbLastStatus, setDbLastStatus] = useState<string>('');
  const [dbLastLog, setDbLastLog] = useState<string>('');
  const [sysNextTime, setSysNextTime] = useState<number>(0);
  const [sysLastStartTime, setSysLastStartTime] = useState<number>(0);
  const [sysLastEndTime, setSysLastEndTime] = useState<number>(0);
  const [sysLastStatus, setSysLastStatus] = useState<string>('');
  const [sysLastLog, setSysLastLog] = useState<string>('');
  const [lastSyncTime, setLastSyncTime] = useState<number>(0);

  // 密码校验功能
  const [verifyPassInput, setVerifyPassInput] = useState('');
  const [verifyResult, setVerifyResult] = useState<'success' | 'fail' | null>(null);

  // GFS 清理超期快照二次确认
  const [previewDeletes, setPreviewDeletes] = useState<any[]>([]);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [pendingConfig, setPendingConfig] = useState<any>(null);

  // 新增：内嵌弹窗与消息状态
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'info' | 'warning' | 'error' } | null>(null);
  const [confirmModal, setConfirmModal] = useState<{
    title: string;
    message: string;
    onConfirm: () => void;
    onCancel?: () => void;
    verifyText?: string;
    verifyPlaceholder?: string;
    danger?: boolean;
  } | null>(null);

  // 新增：导出/导入/标签编辑弹窗
  const [exportModal, setExportModal] = useState<{ isOpen: boolean } | null>(null);
  const [editLabelModal, setEditLabelModal] = useState<{ isOpen: boolean; path: string; currentVal: string } | null>(null);

  // 新增：存储池测试连接状态
  const [testStatus, setTestStatus] = useState<{[key: string]: { status: 'idle' | 'testing' | 'ok' | 'error'; msg: string } | null}>({});

  // 新增：后台实时日志列表
  const [liveLogs, setLiveLogs] = useState<string[]>([]);
  const [enableLiveLogsScroll, setEnableLiveLogsScroll] = useState(true);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const [logScrollTop, setLogScrollTop] = useState(0);
  const latestScrollTopRef = useRef(0);
  const lastUserScrollTime = useRef<number>(0);
  const isAutoScrolling = useRef<boolean>(false);
  const lastLogsLen = useRef<number>(0);

  // 新增：本地同步客户端清单状态
  const [localPullList, setLocalPullList] = useState<any[]>([]);

  // 新增：弹窗内部的输入框绑定状态
  const [confirmInput, setConfirmInput] = useState('');
  const [exportPassword, setExportPassword] = useState('');
  const [editLabelInput, setEditLabelInput] = useState('');

  // 新增：全局限速设置
  const [bandwidthLimit, setBandwidthLimit] = useState<number>(0);
  const [bandwidthUnit, setBandwidthUnit] = useState<'Mbps' | 'MB/s'>('Mbps');

  // 新增：任务大厅复合筛选字段
  const [filterActionTypes, setFilterActionTypes] = useState<string[]>([]);
  const [filterTaskName, setFilterTaskName] = useState('');
  const [filterTrigger, setFilterTrigger] = useState<'all' | 'manual' | 'cron'>('all');
  const [filterTimeRange, setFilterTimeRange] = useState<'all' | 'today' | '7d' | '30d'>('all');
  const [filterTaskStatus, setFilterTaskStatus] = useState<'all' | 'success' | 'error' | 'killed'>('all');

  // 快照存储控制面板 (支持 local_pull 源)
  const [snapshotSourceTab, setSnapshotSourceTab] = useState<'local' | 'local_pull' | 'telegram' | 'onedrive' | 'gdrive' | 'pikpak'>('local');
  const [snapshotList, setSnapshotList] = useState<any[]>([]);
  const [isLoadingSnapshots, setIsLoadingSnapshots] = useState(false);

  // 筛选与排序变量
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'db' | 'sys'>('all');
  const [filterSize, setFilterSize] = useState<'all' | 'small' | 'medium' | 'large' | 'huge'>('all');
  const [filterDate, setFilterDate] = useState<'all' | 'today' | '7d' | '30d'>('all');
  const [sortBy, setSortBy] = useState<'name' | 'size' | 'time'>('time');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  const [backupProgress, setBackupProgress] = useState<number | null>(null);
  const [backupStatusText, setBackupStatusText] = useState('');
  const [isSaved, setIsSaved] = useState(false);
  const [backupLog, setBackupLog] = useState('');
  const [isError, setIsError] = useState(false);

  const [rcloneText, setRcloneText] = useState('');
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 轮询活跃与历史任务列表以及仪表盘状态指标
  useEffect(() => {
    const fetchTasks = () => {
      fetch('/api/tasks/list')
        .then(res => res.json())
        .then(data => {
          if (Array.isArray(data)) {
            setTasks(data);
          }
        })
        .catch(err => console.error("加载监控任务失败:", err));
    };

    const fetchStatusOnly = () => {
      fetch('/api/status')
        .then(res => res.json())
        .then(data => {
          if (data.last_backup_time) setLastBackupTime(data.last_backup_time);
          setSnapshotCount(data.snapshot_count || 0);
          setAssetFileCount(data.asset_file_count || 2);
          setTelegramStatus(data.telegram_status || 'unconfigured');
          setOnedriveStatus(data.onedrive_status || 'unconfigured');
          setGdriveStatus(data.gdrive_status || 'unconfigured');
          setPikpakStatus(data.pikpak_status || 'unconfigured');
          setDownloadToken(data.download_token || '');
          if (data.health_report) setHealthReport(data.health_report);

          if (data.db_next_time !== undefined) setDbNextTime(data.db_next_time);
          if (data.db_last_start_time !== undefined) setDbLastStartTime(data.db_last_start_time);
          if (data.db_last_end_time !== undefined) setDbLastEndTime(data.db_last_end_time);
          if (data.db_last_status) setDbLastStatus(data.db_last_status);
          if (data.db_last_log) setDbLastLog(data.db_last_log);

          if (data.sys_next_time !== undefined) setSysNextTime(data.sys_next_time);
          if (data.sys_last_start_time !== undefined) setSysLastStartTime(data.sys_last_start_time);
          if (data.sys_last_end_time !== undefined) setSysLastEndTime(data.sys_last_end_time);
          if (data.sys_last_status) setSysLastStatus(data.sys_last_status);
          if (data.sys_last_log) setSysLastLog(data.sys_last_log);

          if (data.last_sync_time !== undefined) setLastSyncTime(data.last_sync_time);
          if (data.local_pull_logs) setLocalPullLogs(data.local_pull_logs);
        })
        .catch(err => console.error("获取仪表盘指标失败:", err));
    };

    const pollAll = () => {
      fetchTasks();
      fetchStatusOnly();
    };

    pollAll();
    const interval = setInterval(pollAll, 500);
    return () => clearInterval(interval);
  }, []);

  // 新增：任务大厅复合筛选逻辑
  const filteredTasks = React.useMemo(() => {
    return tasks.filter(t => {
      // 1. 动作类型多选
      if (filterActionTypes.length > 0) {
        if (!filterActionTypes.includes(t.type)) {
          return false;
        }
      }

      // 2. 任务名/ID/物理包名模糊检索
      if (filterTaskName.trim() !== '') {
        const q = filterTaskName.toLowerCase();
        const matchName = t.name.toLowerCase().includes(q);
        const matchId = t.task_id.toLowerCase().includes(q);
        const matchFile = (t.backup_file || '').toLowerCase().includes(q);
        if (!matchName && !matchId && !matchFile) {
          return false;
        }
      }

      // 3. 备份触发源
      if (filterTrigger !== 'all') {
        if (t.trigger !== filterTrigger) {
          return false;
        }
      }

      // 4. 任务状态
      if (filterTaskStatus !== 'all') {
        if (t.status !== filterTaskStatus) {
          return false;
        }
      }

      // 5. 时间范围
      if (filterTimeRange !== 'all') {
        const startTime = new Date(t.start_time).getTime();
        const now = Date.now();
        if (filterTimeRange === 'today') {
          const startOfToday = new Date().setHours(0, 0, 0, 0);
          if (startTime < startOfToday) return false;
        } else if (filterTimeRange === '7d') {
          const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
          if (startTime < sevenDaysAgo) return false;
        } else if (filterTimeRange === '30d') {
          const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
          if (startTime < thirtyDaysAgo) return false;
        }
      }

      return true;
    });
  }, [tasks, filterActionTypes, filterTaskName, filterTrigger, filterTimeRange, filterTaskStatus]);


  // ------------------------------------------------------------------------------
  // 1. 数据请求与初始化
  // ------------------------------------------------------------------------------
  useEffect(() => {
    fetchConfigAndStatus();
    fetchLabels();
    fetchRcloneRemotes(); // 初始化获取 Rclone 物理存储池远端配置列表
    if (false as any) {
      console.log(lastBackupTime, assetFileCount, dbLastLog, sysLastLog);
    }
  }, []);

  useEffect(() => {
    setSelectedPaths([]);
    fetchSnapshots();
    fetchLabels();
  }, [snapshotSourceTab, activeTab]);

  // 定时任务下次执行倒计时更新
  const [dbCountdown, setDbCountdown] = useState<string>('');
  const [sysCountdown, setSysCountdown] = useState<string>('');

  useEffect(() => {
    const updateCountdowns = () => {
      const now = Math.floor(Date.now() / 1000);
      
      if (dbNextTime > 0) {
        const diff = dbNextTime - now;
        if (diff > 0) {
          const h = Math.floor(diff / 3600);
          const m = Math.floor((diff % 3600) / 60);
          const s = diff % 60;
          setDbCountdown(`${h}小时${m}分${s}秒`);
        } else {
          setDbCountdown('正在排队备份...');
        }
      } else {
        setDbCountdown('未就绪 / 已停用');
      }

      if (sysNextTime > 0) {
        const diff = sysNextTime - now;
        if (diff > 0) {
          const h = Math.floor(diff / 3600);
          const m = Math.floor((diff % 3600) / 60);
          const s = diff % 60;
          setSysCountdown(`${h}小时${m}分${s}秒`);
        } else {
          setSysCountdown('正在排队备份...');
        }
      } else {
        setSysCountdown('未就绪 / 已停用');
      }
    };

    updateCountdowns();
    const interval = setInterval(updateCountdowns, 1000);
    return () => clearInterval(interval);
  }, [dbNextTime, sysNextTime]);

  // 仪表盘 Tab 活跃时，高频 500ms 轮询最新日志
  useEffect(() => {
    let intervalId: any = null;
    if (activeTab === 'dashboard') {
      const fetchLogs = () => {
        fetch('/api/logs')
          .then(res => res.json())
          .then(data => {
            if (Array.isArray(data)) {
              setLiveLogs(data);
            }
          })
          .catch(err => console.error("读取日志接口失败:", err));
      };
      fetchLogs();
      intervalId = setInterval(fetchLogs, 500);
    }
    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [activeTab]);

  // 当日志更新时，在用户 3 秒内没有滑动且开启滚动刷新时，自动滚动到终端底部
  useEffect(() => {
    if (enableLiveLogsScroll && liveLogs.length > lastLogsLen.current) {
      const now = Date.now();
      if (now - lastUserScrollTime.current > 3000) {
        if (logContainerRef.current) {
          isAutoScrolling.current = true;
          logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
        }
      }
    }
    lastLogsLen.current = liveLogs.length;
  }, [liveLogs, enableLiveLogsScroll]);

  // 监听 Tab 切换。如果回到仪表盘，则重置日志虚拟滚动 scrollTop 状态并强制拽底，防范 DOM 卸载错位空白
  // 当 Tab 切换回仪表盘时，智能同步物理滚动条与虚拟状态，记录之前的滚动位置，防止空白
  useEffect(() => {
    if (activeTab === 'dashboard') {
      const timer = setTimeout(() => {
        if (logContainerRef.current) {
          const now = Date.now();
          // 如果开启了自动拽底，且之前处于自动拽底状态（即最近3秒内无手动滚动）
          if (enableLiveLogsScroll && (now - lastUserScrollTime.current > 3000)) {
            logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
            setLogScrollTop(logContainerRef.current.scrollHeight);
          } else {
            // 否则恢复之前的精确滚动位置
            logContainerRef.current.scrollTop = latestScrollTopRef.current;
            setLogScrollTop(latestScrollTopRef.current);
          }
        }
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [activeTab]);

  const handleLogScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    setLogScrollTop(target.scrollTop);
    latestScrollTopRef.current = target.scrollTop;

    if (isAutoScrolling.current) {
      isAutoScrolling.current = false;
      return;
    }
    lastUserScrollTime.current = Date.now();
  };

  // Toast 气泡 3 秒后自动消失
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  // 封装通用的 Toast 函数
  const showToast = (message: string, type: 'success' | 'info' | 'warning' | 'error' = 'info') => {
    setToast({ message, type });
  };

  // 封装通用的 Confirm 确认弹窗函数
  const triggerConfirm = (
    title: string,
    message: string,
    onConfirm: () => void,
    options?: { danger?: boolean; verifyText?: string; verifyPlaceholder?: string }
  ) => {
    setConfirmModal({
      title,
      message,
      onConfirm: () => {
        onConfirm();
        setConfirmModal(null);
      },
      onCancel: () => setConfirmModal(null),
      verifyText: options?.verifyText,
      verifyPlaceholder: options?.verifyPlaceholder,
      danger: options?.danger,
    });
  };

  const fetchConfigAndStatus = () => {
    fetch('/api/config')
      .then(res => res.json())
      .then(data => {
        if (data.telegram_bot_token) setTgToken(data.telegram_bot_token);
        if (data.telegram_chat_id) setTgChatId(data.telegram_chat_id);
        if (data.telegram_api_url) setTgApiUrl(data.telegram_api_url);
        if (data.backup_password) setBackupPass(data.backup_password);
        if (data.cron_hours_db) setCronHoursDB(data.cron_hours_db);
        if (data.cron_hours_sys) setCronHoursSys(data.cron_hours_sys);
        
        if (data.local_db_rule) setLocalDBRule(data.local_db_rule);
        if (data.local_sys_rule) setLocalSysRule(data.local_sys_rule);
        if (data.telegram_db_rule) setTelegramDBRule(data.telegram_db_rule);
        if (data.telegram_sys_rule) setTelegramSysRule(data.telegram_sys_rule);
        if (data.onedrive_db_rule) setOneDriveDBRule(data.onedrive_db_rule);
        if (data.onedrive_sys_rule) setOneDriveSysRule(data.onedrive_sys_rule);
        if (data.gdrive_db_rule) setGDriveDBRule(data.gdrive_db_rule);
        if (data.gdrive_sys_rule) setGDriveSysRule(data.gdrive_sys_rule);
        if (data.pikpak_db_rule) setPikpakDBRule(data.pikpak_db_rule);
        if (data.pikpak_sys_rule) setPikpakSysRule(data.pikpak_sys_rule);

        // 加载冷备 GFS 规则
        if (data.local_pull_db_rule) setLocalPullDBRule(data.local_pull_db_rule);
        if (data.local_pull_sys_rule) setLocalPullSysRule(data.local_pull_sys_rule);

        if (data.local_pull_path) setLocalPullPath(data.local_pull_path);
        if (data.pikpak_url) setPikpakURL(data.pikpak_url);
        if (data.pikpak_user) setPikpakUser(data.pikpak_user);
        if (data.pikpak_pass) setPikpakPass(data.pikpak_pass);

        if (data.system_backup_mode) setSystemBackupMode(data.system_backup_mode);
        if (typeof data.use_rclone_crypt === 'boolean') setUseRcloneCrypt(data.use_rclone_crypt);
        if (data.custom_paths) setCustomPathsText(data.custom_paths.join('\n'));
        if (data.task_history_limit) setTaskHistoryLimit(data.task_history_limit);
        if (data.log_keep_days) setLogKeepDays(data.log_keep_days);
        if (data.bandwidth_limit !== undefined) setBandwidthLimit(data.bandwidth_limit);
        if (data.bandwidth_unit) setBandwidthUnit(data.bandwidth_unit);
        fetchLocalPullSnapshots();
      })
      .catch(err => console.error("读取全局配置失败:", err));

    fetch('/api/status')
      .then(res => res.json())
      .then(data => {
        if (data.last_backup_time) setLastBackupTime(data.last_backup_time);
        setSnapshotCount(data.snapshot_count || 0);
        setAssetFileCount(data.asset_file_count || 2);
        setTelegramStatus(data.telegram_status || 'unconfigured');
        setOnedriveStatus(data.onedrive_status || 'unconfigured');
        setGdriveStatus(data.gdrive_status || 'unconfigured');
        setPikpakStatus(data.pikpak_status || 'unconfigured');
        setDownloadToken(data.download_token || '');
        if (data.health_report) setHealthReport(data.health_report);

        // 设置定时任务下次执行的时间戳及运行历史
        if (data.db_next_time) setDbNextTime(data.db_next_time);
        if (data.db_last_start_time) setDbLastStartTime(data.db_last_start_time);
        if (data.db_last_end_time) setDbLastEndTime(data.db_last_end_time);
        if (data.db_last_status) setDbLastStatus(data.db_last_status);
        if (data.db_last_log) setDbLastLog(data.db_last_log);

        if (data.sys_next_time) setSysNextTime(data.sys_next_time);
        if (data.sys_last_start_time) setSysLastStartTime(data.sys_last_start_time);
        if (data.sys_last_end_time) setSysLastEndTime(data.sys_last_end_time);
        if (data.sys_last_status) setSysLastStatus(data.sys_last_status);
        if (data.sys_last_log) setSysLastLog(data.sys_last_log);

        if (data.last_sync_time) setLastSyncTime(data.last_sync_time);
        if (data.local_pull_logs) setLocalPullLogs(data.local_pull_logs);
      })
      .catch(err => console.error("获取仪表盘指标失败:", err));

    fetchRcloneRemotes(); // 刷新配置和状态时一并拉取物理存储池远端配置
  };

  // 新机快速部署一键指令自动生成
  useEffect(() => {
    if (downloadToken) {
      fetch(`/api/deploy/generate-bootstrap?token=${downloadToken}`)
        .then(res => {
          if (!res.ok) throw new Error('拉取一键部署指令失败');
          return res.text();
        })
        .then(text => {
          setBootstrapCmd(text);
        })
        .catch(err => {
          console.error("生成部署指令失败:", err);
          setBootstrapCmd('❌ 无法生成一键部署指令，请检查网络或点击下载文件');
        });
    }
  }, [downloadToken]);

  const fetchSnapshots = () => {
    if (activeTab !== 'dashboard') return;
    setIsLoadingSnapshots(true);
    fetch(`/api/backups?source=${snapshotSourceTab}`)
      .then(res => res.json())
      .then(data => {
        setSnapshotList(Array.isArray(data) ? data : []);
        setIsLoadingSnapshots(false);
      })
      .catch(err => {
        console.error("加载快照列表失败:", err);
        setSnapshotList([]);
        setIsLoadingSnapshots(false);
      });
  };

  // ------------------------------------------------------------------------------
  // 2. GFS 淘汰规则保存逻辑（校验与弹窗确认）
  // ------------------------------------------------------------------------------
  const handleSaveConfig = () => {
    const customPathsArray = customPathsText
      .split('\n')
      .map(p => p.trim())
      .filter(p => p !== '');

    const payload = {
      telegram_bot_token: tgToken,
      telegram_api_url: tgApiUrl,
      telegram_chat_id: tgChatId,
      backup_password: backupPass,
      cron_hours_db: cronHoursDB,
      cron_hours_sys: cronHoursSys,
      local_db_rule: localDBRule,
      local_sys_rule: localSysRule,
      telegram_db_rule: telegramDBRule,
      telegram_sys_rule: telegramSysRule,
      onedrive_db_rule: onedriveDBRule,
      onedrive_sys_rule: onedriveSysRule,
      gdrive_db_rule: gdriveDBRule,
      gdrive_sys_rule: gdriveSysRule,
      pikpak_db_rule: pikpakDBRule,
      pikpak_sys_rule: pikpakSysRule,
      local_pull_db_rule: localPullDBRule,
      local_pull_sys_rule: localPullSysRule,
      local_pull_path: localPullPath,
      pikpak_url: pikpakURL,
      pikpak_user: pikpakUser,
      pikpak_pass: pikpakPass,
      system_backup_mode: systemBackupMode,
      use_rclone_crypt: useRcloneCrypt,
      custom_paths: customPathsArray,
      task_history_limit: taskHistoryLimit,
      log_keep_days: logKeepDays,
      bandwidth_limit: bandwidthLimit,
      bandwidth_unit: bandwidthUnit
    };

    // 保存前校验规则变更会导致哪些快照文件被淘汰
    fetch('/api/config/preview-cleanup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
      .then(res => res.json())
      .then(deletes => {
        if (Array.isArray(deletes) && deletes.length > 0) {
          // 有待淘汰快照，弹出二次确认框
          setPreviewDeletes(deletes);
          setPendingConfig(payload);
          setShowPreviewModal(true);
        } else {
          // 无待淘汰文件，直接保存
          saveConfigDirectly(payload);
        }
      })
      .catch(err => {
        console.error("规则淘汰校对失败:", err);
        saveConfigDirectly(payload);
      });
  };

  const saveConfigDirectly = (payload: any) => {
    fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
      .then(res => res.json())
      .then(() => {
        setIsSaved(true);
        fetchConfigAndStatus();
        fetchSnapshots();
        setShowPreviewModal(false);
        setTimeout(() => setIsSaved(false), 3000);
      })
      .catch(err => {
        console.error("保存配置失败:", err);
        showToast("配置保存失败，请检查网络或服务状态！", "error");
      });
  };

  // ------------------------------------------------------------------------------
  // 3.5 扩展高级备份与标签/批量操作方法
  // ------------------------------------------------------------------------------
  const fetchLabels = () => {
    fetch('/api/backups/labels')
      .then(res => res.json())
      .then(data => setLabels(data.labels || {}))
      .catch(err => console.error("读取 labels 失败:", err));
  };

  const handleEditLabel = (path: string, currentVal: string) => {
    setEditLabelInput(currentVal);
    setEditLabelModal({ isOpen: true, path, currentVal });
  };

  const handleSaveLabel = (filename: string, label: string) => {
    fetch('/api/backups/labels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename, label })
    })
      .then(res => {
        if (!res.ok) throw new Error("保存备注失败");
        return res.json();
      })
      .then(() => {
        showToast("备注保存成功！", "success");
        fetchLabels();
        fetchSnapshots();
        if (snapshotSourceTab === 'local_pull') {
          fetchLocalPullSnapshots();
        }
        setEditLabelModal(null);
        setEditLabelInput('');
      })
      .catch(err => {
        showToast(err.message, "error");
      });
  };

  const fetchLocalPullSnapshots = () => {
    fetch('/api/backups?source=local_pull')
      .then(res => res.json())
      .then(data => {
        setLocalPullList(Array.isArray(data) ? data : []);
      })
      .catch(err => {
        console.error("加载本地拉取清单失败:", err);
        setLocalPullList([]);
      });
  };

  const handleDeleteLocalPullSnapshot = (filename: string) => {
    triggerConfirm(
      "⚠️ 从本地同步清单移除快照",
      `您确定要将 [${filename}] 从本地拉取虚拟清单中移除吗？\n当本地客户端下一次连接同步时，该快照文件将会在本地物理硬盘上被自动删除！`,
      () => {
        fetch('/api/backups', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename, source: 'local_pull' })
        })
          .then(res => {
            if (!res.ok) throw new Error("从清单移除失败");
            return res.json();
          })
          .then(() => {
            showToast("已成功从本地同步清单移除", "success");
            fetchLocalPullSnapshots();
          })
          .catch(err => showToast("移除失败：" + err.message, "error"));
      },
      { danger: true }
    );
  };

  const handleTestConnection = (type: string) => {
    setTestStatus(prev => ({ ...prev, [type]: { status: 'testing', msg: '正在测试连接中，请稍候...' } }));
    
    const payload: any = { type };
    if (type === 'telegram') {
      payload.telegram_bot_token = tgToken;
      payload.telegram_api_url = tgApiUrl;
    } else if (type === 'pikpak') {
      payload.pikpak_url = pikpakURL;
      payload.pikpak_user = pikpakUser;
      payload.pikpak_pass = pikpakPass;
    }
    
    fetch('/api/settings/test-connection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
      .then(async res => {
        const data = await res.json();
        if (res.ok && data.status === 'ok') {
          setTestStatus(prev => ({ ...prev, [type]: { status: 'ok', msg: data.message || '连接测试成功！' } }));
          showToast(`${type.toUpperCase()} 连接测试成功！`, 'success');
        } else {
          setTestStatus(prev => ({ ...prev, [type]: { status: 'error', msg: data.message || '连接测试失败！' } }));
          showToast(`${type.toUpperCase()} 连接测试失败，请检查配置！`, 'error');
        }
      })
      .catch(err => {
        console.error("测试连接请求失败:", err);
        setTestStatus(prev => ({ ...prev, [type]: { status: 'error', msg: '网络请求故障，请稍后重试！' } }));
        showToast(`${type.toUpperCase()} 连接测试请求失败！`, 'error');
      });
  };

  const handleBatchDelete = () => {
    if (selectedPaths.length === 0) return;
    triggerConfirm(
      "🗑️ 批量删除快照",
      `您确定要批量删除这 ${selectedPaths.length} 个快照文件吗？此操作将立即从对应存储池中物理清除，不可恢复！`,
      () => {
        fetch('/api/backups', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filenames: selectedPaths,
            source: snapshotSourceTab
          })
        })
          .then(res => res.json())
          .then(data => {
            showToast(data.message || "批量删除成功！", "success");
            setSelectedPaths([]);
            fetchSnapshots();
          })
          .catch(err => {
            console.error("批量删除失败:", err);
            showToast("批量删除失败，请核对网络！", "error");
          });
      },
      { danger: true }
    );
  };

  const handleBatchRestore = () => {
    if (selectedPaths.length === 0) return;
    const hasSys = selectedPaths.some(p => p.startsWith('system_'));
    if (hasSys) {
      showToast("批量恢复模式下，不支持非数据库（系统配置）快照，请重新选择！", "warning");
      return;
    }
    triggerConfirm(
      "🔒 批量恢复数据库",
      `确定要依次还原这 ${selectedPaths.length} 个数据库快照吗？系统将会自动覆盖还原并重新载入对应的数据服务！`,
      () => {
        fetch('/api/backups', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filenames: selectedPaths,
            source: snapshotSourceTab
          })
        })
          .then(res => res.json())
          .then(() => {
            showToast("批量恢复指令发送成功，正在后台还原！", "success");
            setSelectedPaths([]);
            fetchSnapshots();
          })
          .catch(err => {
            console.error("批量恢复失败:", err);
            showToast("批量恢复指令发送失败！", "error");
          });
      }
    );
  };

  const handleTransferSnapshot = (filename: string, destPool: string) => {
    const isUpload = snapshotSourceTab === 'local';
    const msg = isUpload ? `上传快照 [${filename}] 到存储池 [${destPool}]` : `从存储池 [${snapshotSourceTab}] 拉取快照 [${filename}] 到服务器`;
    
    triggerConfirm(
      "⚡ 跨池快照传输",
      `您确定要执行跨池同步操作：【${msg}】吗？`,
      () => {
        fetch('/api/backups/transfer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            src_pool: isUpload ? 'local' : snapshotSourceTab,
            dest_pool: isUpload ? destPool : 'local',
            filenames: [filename]
          })
        })
          .then(async res => {
            if (res.ok) {
              const data = await res.json();
              showToast(`传输成功！${data.message || ''}`, "success");
              fetchSnapshots();
            } else {
              const text = await res.text();
              showToast(`传输失败: ${text}`, "error");
            }
          })
          .catch(err => {
            console.error("跨池传输失败:", err);
            showToast("跨池传输遭遇网络异常，请重试！", "error");
          });
      }
    );
  };

  const handleControlTask = (taskId: string, action: 'pause' | 'resume' | 'kill') => {
    const actionText = action === 'pause' ? '挂起暂缓' : action === 'resume' ? '恢复运行' : '强制终断';
    triggerConfirm(
      `${actionText}后台任务`,
      `您确定要对该备份/传输进程执行【${actionText}】控制指令吗？`,
      () => {
        fetch('/api/tasks/control', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ task_id: taskId, action })
        })
          .then(async res => {
            if (res.ok) {
              const data = await res.json();
              showToast(data.message || "指令下发成功", "success");
              // 重新拉取任务状态
              fetch('/api/tasks/list')
                .then(res => res.json())
                .then(data => {
                  if (Array.isArray(data)) setTasks(data);
                });
            } else {
              const text = await res.text();
              showToast("指令执行失败: " + text, "error");
            }
          })
          .catch(err => showToast("请求遇到异常: " + err.message, "error"));
      }
    );
  };

  const handleArchiveSnapshot = (filename: string, action: 'keep' | 'unkeep') => {
    const actionText = action === 'keep' ? '锁定永久留档' : '解锁取消留档';
    triggerConfirm(
      `${actionText}确认`,
      `您确定要对快照 [${filename}] 执行【${actionText}】操作吗？被永久留档的快照将受底层物理/逻辑保护，不参与 GFS 轮转淘汰清理。`,
      () => {
        fetch('/api/backups/archive', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            source: snapshotSourceTab,
            filename,
            action
          })
        })
          .then(async res => {
            if (res.ok) {
              const data = await res.json();
              showToast(data.message || "留档属性更新成功", "success");
              fetchSnapshots();
              if (snapshotSourceTab === 'local_pull') {
                fetchLocalPullSnapshots();
              }
            } else {
              const text = await res.text();
              showToast("操作失败: " + text, "error");
            }
          })
          .catch(err => showToast("请求故障: " + err.message, "error"));
      }
    );
  };

  const handleBatchArchive = (action: 'keep' | 'unkeep') => {
    if (selectedPaths.length === 0) return;
    const actionText = action === 'keep' ? '批量永久留档' : '批量取消留档';
    triggerConfirm(
      `${actionText}确认`,
      `您确定要对选中的这 ${selectedPaths.length} 个快照包执行【${actionText}】吗？`,
      () => {
        const promises = selectedPaths.map(path =>
          fetch('/api/backups/archive', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              source: snapshotSourceTab,
              filename: path,
              action
            })
          }).then(async res => {
            if (!res.ok) {
              const text = await res.text();
              throw new Error(text);
            }
            return res.json();
          })
        );

        Promise.all(promises)
          .then(() => {
            showToast(`批量【${actionText}】成功！`, "success");
            setSelectedPaths([]);
            fetchSnapshots();
          })
          .catch(err => showToast("批量留档操作中部分失败: " + err.message, "error"));
      }
    );
  };

  const handleExportSettings = () => {
    setExportModal({ isOpen: true });
  };

  const handleImportFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setImportFile(e.target.files[0]);
    }
  };

  // 新增：用于解密输入框的状态
  const [showDecryptModal, setShowDecryptModal] = useState(false);
  const [decryptPassword, setDecryptPassword] = useState('');

  const handleDecryptAndParseSettings = () => {
    if (!importFile) {
      showToast("请先选择导出的加密配置包 (.enc)！", "warning");
      return;
    }
    setDecryptPassword('');
    setShowDecryptModal(true);
  };

  const performDecrypt = (pwd: string) => {
    setShowDecryptModal(false);
    const formData = new FormData();
    formData.append("file", importFile!);
    formData.append("password", pwd);

    fetch('/api/settings/import', {
      method: 'POST',
      body: formData
    })
      .then(async res => {
        if (res.ok) {
          const data = await res.json();
          setImportModules(data.modules || null);
          const compatKeys = Object.entries(data.modules || {})
            .filter(([_, info]: [string, any]) => info.available && info.compatible)
            .map(([key]) => key);
          setSelectedImportModules(compatKeys);
          showToast("解密配置包成功，请勾选需要恢复的模块！", "success");
        } else {
          const errText = await res.text();
          showToast(`解密校验失败: ${errText}`, "error");
        }
      })
      .catch(err => {
        console.error("解密校验请求失败:", err);
        showToast("解密失败，请检查密码或上传的文件格式！", "error");
      });
  };

  const handleConfirmImportSettings = () => {
    if (selectedImportModules.length === 0) return;
    triggerConfirm(
      "⚙️ 还原覆盖系统配置",
      `您确认要将选中的 [${selectedImportModules.join(', ')}] 还原并完全覆盖覆盖至当前系统吗？该操作将即时更新系统参数并重启定时调度器！`,
      () => {
        fetch('/api/settings/import/confirm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            selected_modules: selectedImportModules
          })
        })
          .then(async res => {
            if (res.ok) {
              showToast("配置文件成功导入并完全覆盖！", "success");
              setImportModules(null);
              setImportFile(null);
              setSelectedImportModules([]);
              fetchConfigAndStatus();
              fetchSnapshots();
            } else {
              const text = await res.text();
              showToast(`导入覆盖失败: ${text}`, "error");
            }
          })
          .catch(err => {
            console.error("确认导入失败:", err);
            showToast("导入覆盖遇到网络错误，请稍后重试！", "error");
          });
      }
    );
  };

  // ------------------------------------------------------------------------------
  // 3. 密码强校验机制
  // ------------------------------------------------------------------------------
  const handleVerifyPassword = () => {
    if (!verifyPassInput.trim()) {
      showToast("请输入待校验的密码！", "warning");
      return;
    }
    fetch('/api/config/verify-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: verifyPassInput })
    })
      .then(res => res.json())
      .then(data => {
        if (data.matched) {
          setVerifyResult('success');
        } else {
          setVerifyResult('fail');
        }
        setTimeout(() => setVerifyResult(null), 4000);
      })
      .catch(err => {
        console.error("密码校验失败:", err);
        showToast("密码校验请求遇到网络错误！", "error");
      });
  };

  // ------------------------------------------------------------------------------
  // 4. 手动备份与还原
  // ------------------------------------------------------------------------------
  const triggerBackupNow = (type: 'db' | 'sys' | 'img') => {
    setIsError(false);
    setBackupLog('');
    const backupLabel = type === 'db' ? '数据库与自选热备' : type === 'sys' ? '系统全盘配置' : '应用容器镜像';
    showToast(`正在提交后台备份任务: ${backupLabel}...`, "info");

    fetch(`/api/backup/now?type=${type}`, { method: 'POST' })
      .then(res => {
        return res.json().then(data => {
          if (!res.ok) {
            throw new Error(data.message || "备份任务提交失败");
          }
          return data;
        });
      })
      .then(data => {
        showToast(data.message || '备份任务已在后台启动！', "success");
        fetchConfigAndStatus();
      })
      .catch(err => {
        showToast('提交备份失败：' + err.message, "error");
        setIsError(true);
        setBackupLog(err.message);
        fetchConfigAndStatus();
      });
  };

  const handleRefreshToken = () => {
    triggerConfirm(
      "🔄 警告：重置安全 API Token",
      "重置 Token 后，已存在的本地客户端同步脚本中的旧密钥将失效，您必须回到此页面重新下载安装包。确认重置？",
      () => {
        fetch('/api/local-pull/refresh-token', {
          method: 'POST',
        })
          .then(res => res.json())
          .then(data => {
            if (data.status === 'ok') {
              setDownloadToken(data.token);
              showToast("安全 Token 已重新生成并存盘生效！", "success");
            } else {
              showToast("重置 Token 失败！", "error");
            }
          })
          .catch(err => {
            console.error("重置 Token 失败:", err);
            showToast("请求 Token 刷新失败", "error");
          });
      },
      { danger: true }
    );
  };

  const [rcloneRemotes, setRcloneRemotes] = useState<any[]>([]);

  const fetchRcloneRemotes = () => {
    fetch('/api/rclone/remotes')
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) {
          setRcloneRemotes(data);
        }
      })
      .catch(err => console.error("加载 Rclone 物理存储池列表失败:", err));
  };

  const handleDeleteRcloneRemote = (remoteName: string) => {
    triggerConfirm(
      "⚠️ 危险操作：物理卸载 Rclone 存储池远端",
      `您确定要从 VPS 宿主机中彻底删除存储池远端 [${remoteName}] 吗？该操作将直接从 rclone.conf 中物理抹除其配置。请确认是否继续？`,
      () => {
        fetch('/api/rclone/remotes/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ remote_name: remoteName })
        })
          .then(res => res.json())
          .then(data => {
            if (data.status === 'ok') {
              showToast(data.message || '物理删除成功！', "success");
              fetchRcloneRemotes();
              fetchConfigAndStatus();
            } else {
              showToast(data.message || '删除远端失败', "error");
            }
          })
          .catch(err => {
            console.error("删除远端错误:", err);
            showToast("发送删除远端请求失败", "error");
          });
      },
      { danger: true, verifyText: remoteName, verifyPlaceholder: `请输入 ${remoteName} 确认` }
    );
  };

  const handleRestoreSnapshot = (filename: string) => {
    const isSys = filename.startsWith('system_full_') || filename.startsWith('system_inc_');
    const isImg = filename.startsWith('system_images_');

    const snapInfo = getFilteredAndSortedSnapshots().find(s => s.Path === filename);
    const sizeStr = snapInfo ? formatBytes(snapInfo.Size) : '未知';
    const timeStr = snapInfo ? new Date(snapInfo.ModTime).toLocaleString() : '未知';

    let title = "";
    let warningText = "";

    if (isImg) {
      title = "🐳 Docker 镜像全量导入确认";
      warningText = `即将从快照 [${filename}] 导入所有 Docker 镜像。\n\n📦 快照信息：\n  • 文件大小: ${sizeStr}\n  • 备份时间: ${timeStr}\n\n🐳 操作内容：解密并执行 docker load 导入所有镜像\n⏱️ 预计耗时较长（可能数分钟至数十分钟）\n\n确认执行吗？`;
    } else if (isSys) {
      title = "🚨 系统配置还原警告";
      warningText = `即将将系统配置恢复到快照 [${filename}] 时的状态！\n\n📦 快照信息：\n  • 文件大小: ${sizeStr}\n  • 备份时间: ${timeStr}\n\n🎯 覆盖范围：/opt/stacks 下所有项目配置\n🔄 还原后将自动重启所有 Docker 项目容器\n✅ 已自动创建安全回滚快照\n⚠️ 重启期间服务将短暂不可用（约 30-60 秒）\n\n确认执行吗？`;
    } else {
      title = "🔒 数据库还原确认";
      warningText = `即将将数据库恢复到快照 [${filename}] 时的状态。\n\n📦 快照信息：\n  • 文件大小: ${sizeStr}\n  • 备份时间: ${timeStr}\n\n🗃️ 将写回：Vaultwarden 数据库 + LLDAP 数据库 + 自选文件\n⚠️ 当前数据将被直接覆盖！\n\n确认执行吗？`;
    }

    triggerConfirm(
      title,
      warningText,
      () => {
        setBackupProgress(20);
        setIsError(false);
        setBackupLog('');
        setBackupStatusText(`正在从存储池 [${snapshotSourceTab}] 提取并解密还原快照 [${filename}] ...`);

        fetch('/api/backups/restore', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename, source: snapshotSourceTab })
        })
          .then(res => {
            setBackupProgress(null);
            return res.json().then(data => {
              if (!res.ok) throw new Error(data.message || "恢复失败");
              return data;
            });
          })
          .then(data => {
            showToast(data.message, "success");
            fetchConfigAndStatus();
          })
          .catch(err => {
            showToast("快照一键还原失败：" + err.message, "error");
            setIsError(true);
            setBackupStatusText("一键还原遭遇错误：" + err.message);
          });
      },
      { danger: isSys || isImg }
    );
  };

  const handleDeleteSnapshot = (filename: string) => {
    triggerConfirm(
      "⚠️ 彻底删除快照警告",
      `确定要彻底删除快照 ${filename} 吗？该操作将从对应存储池中物理清除该包，此操作不可逆！`,
      () => {
        fetch('/api/backups', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename, source: snapshotSourceTab })
        })
          .then(res => {
            if (!res.ok) throw new Error("删除失败");
            return res.json();
          })
          .then(() => {
            showToast("快照已成功删除", "success");
            fetchConfigAndStatus();
            fetchSnapshots();
          })
          .catch(err => showToast("删除快照失败：" + err.message, "error"));
      },
      { danger: true }
    );
  };

  // ------------------------------------------------------------------------------
  // 5. rclone.conf 上传操作修复 (点击与拖拽)
  // ------------------------------------------------------------------------------
  // ==============================================================================
  // 网页快捷 OAuth 授权核心交互逻辑
  // ==============================================================================
  const handleFetchOAuthUrls = () => {
    setOauthLoading(true);
    setManualCode('');
    fetch(`/api/oauth/auth-url?type=${activeDest}&redirect_host=${encodeURIComponent(window.location.origin)}`)
      .then(res => {
        if (!res.ok) throw new Error("获取授权链接失败");
        return res.json();
      })
      .then(data => {
        setOauthUrls(data);
        setShowOAuthModal(true);
      })
      .catch(err => showToast(err.message, "error"))
      .finally(() => setOauthLoading(false));
  };

  const handleSubmitOAuthCode = () => {
    if (!manualCode.trim()) {
      showToast("请先粘贴授权码或完整跳转链接！", "error");
      return;
    }
    setOauthSubmitLoading(true);
    fetch('/api/oauth/submit-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: activeDest, code: manualCode, redirect_uri: 'http://127.0.0.1:53682/' })
    })
      .then(res => {
        if (!res.ok) return res.json().then(d => { throw new Error(d.message || "手动置换 Token 失败") });
        return res.json();
      })
      .then(data => {
        showToast(data.message || "手动授权成功并已重载凭证！", "success");
        setShowOAuthModal(false);
        fetchConfigAndStatus();
      })
      .catch(err => showToast(err.message, "error"))
      .finally(() => setOauthSubmitLoading(false));
  };

  const handleRcloneSubmit = (contentStr: string) => {
    if (!contentStr.trim()) return;
    fetch('/api/config/rclone', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: contentStr })
    })
      .then(res => res.json())
      .then(data => {
        showToast(data.message || "云盘凭证重载完毕", "success");
        setRcloneText(contentStr);
        fetchConfigAndStatus();
      })
      .catch(err => {
        console.error("上传凭证失败:", err);
        showToast("上传 rclone.conf 失败，请检查网络！", "error");
      });
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      handleRcloneSubmit(text);
    };
    reader.readAsText(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      handleRcloneSubmit(text);
    };
    reader.readAsText(file);
  };

  // ------------------------------------------------------------------------------
  // 6. GFS 规则中文翻译解释器
  // ------------------------------------------------------------------------------
  const explainGFSRule = (rule: string) => {
    if (!rule || rule.trim() === "" || rule.toLowerCase().trim() === "forever") {
      return "【永久冷备】此存储池对所有快照进行无限期物理保留，永不清理。";
    }

    const explanations: string[] = [];
    const parts = rule.split(";");
    for (const part of parts) {
      const kv = part.split(":");
      if (kv.length !== 2) continue;
      const k = kv[0].trim().toLowerCase();
      const v = kv[1].trim().toLowerCase();

      let valText = "";
      if (v === "forever" || v === "always" || v === "-1") {
        valText = "永久保留";
      } else if (v === "never" || v === "0") {
        valText = "不保留";
      } else {
        const unit = v.slice(-1);
        const num = v.slice(0, -1);
        let unitText = "小时";
        if (unit === 'd') unitText = "天";
        else if (unit === 'w') unitText = "周";
        else if (unit === 'm') unitText = "个月";
        else if (unit === 'y') unitText = "年";
        valText = `保留最近 ${num} ${unitText}内`;
      }

      switch (k) {
        case 'h':
        case 'hourly':
          explanations.push(`每小时备份：${valText}的每一份快照`);
          break;
        case 'd':
        case 'daily':
          explanations.push(`每日备份：${valText}每日的最新快照`);
          break;
        case 'w':
        case 'weekly':
          explanations.push(`每周备份：${valText}每周的最新快照`);
          break;
        case 'm':
        case 'monthly':
          explanations.push(`每月备份：${valText}每月的最新快照`);
          break;
        case 'y':
        case 'yearly':
          explanations.push(`每年备份：${valText}每年的最新快照`);
          break;
      }
    }
    return "【GFS 规则解析】在清理时：" + explanations.join("；") + "。";
  };

  // ------------------------------------------------------------------------------
  // 7. 快照列表的过滤与排序计算
  // ------------------------------------------------------------------------------
  const getFilteredAndSortedSnapshots = () => {
    let result = [...snapshotList];

    // 1. 模糊搜索
    if (searchQuery.trim() !== '') {
      result = result.filter(snap => snap.Path.toLowerCase().includes(searchQuery.toLowerCase()));
    }

    // 1.5 留档过滤
    if (filterKeepOnly) {
      result = result.filter(snap => snap.Path.toLowerCase().includes('_keep_'));
    }

    // 2. 备份类型过滤
    if (filterType === 'db') {
      result = result.filter(snap => snap.Path.startsWith('db_hourly_'));
    } else if (filterType === 'sys') {
      result = result.filter(snap => snap.Path.startsWith('system_'));
    }

    // 3. 大小过滤
    if (filterSize !== 'all') {
      result = result.filter(snap => {
        const bytes = snap.Size;
        if (filterSize === 'small') return bytes < 1024 * 1024; // < 1MB
        if (filterSize === 'medium') return bytes >= 1024 * 1024 && bytes < 10 * 1024 * 1024; // 1MB-10MB
        if (filterSize === 'large') return bytes >= 10 * 1024 * 1024 && bytes < 100 * 1024 * 1024; // 10MB-100MB
        if (filterSize === 'huge') return bytes >= 100 * 1024 * 1024; // > 100MB
        return true;
      });
    }

    // 4. 时间过滤
    if (filterDate !== 'all') {
      const now = new Date();
      result = result.filter(snap => {
        const diff = now.getTime() - new Date(snap.ModTime).getTime();
        const oneDay = 24 * 60 * 60 * 1000;
        if (filterDate === 'today') return diff < oneDay;
        if (filterDate === '7d') return diff < 7 * oneDay;
        if (filterDate === '30d') return diff < 30 * oneDay;
        return true;
      });
    }

    // 5. 排序
    result.sort((a, b) => {
      let valA: any = a.Path;
      let valB: any = b.Path;

      if (sortBy === 'size') {
        valA = a.Size;
        valB = b.Size;
      } else if (sortBy === 'time') {
        valA = new Date(a.ModTime).getTime();
        valB = new Date(b.ModTime).getTime();
      }

      if (valA < valB) return sortOrder === 'asc' ? -1 : 1;
      if (valA > valB) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });

    return result;
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const renderStatusBadge = (status: string) => {
    switch (status) {
      case 'connected':
        return <span className="text-xs text-[#10B981] bg-[#10B981]/10 px-2.5 py-1 rounded-full font-semibold">已连接</span>;
      case 'error':
        return <span className="text-xs text-red-500 bg-red-500/10 px-2.5 py-1 rounded-full font-semibold font-mono">凭证无效</span>;
      default:
        return <span className="text-xs text-gray-500 bg-gray-500/10 px-2.5 py-1 rounded-full font-semibold">未配置</span>;
    }
  };

  const vpsOrigin = window.location.origin;
  const dynamicPsScript = `# Windows 本地备份拉取与自适应删增同步脚本 (sync_to_local.ps1)
$LocalBackupDir = "${localPullPath}"
$VpsOrigin = "${vpsOrigin}"
$Token = "${downloadToken}"

$DownloadUrl = "$VpsOrigin/api/local-pull/download-zip?token=$Token&path=" + [Adns.Utility]::UrlEncode($LocalBackupDir)
Write-Host ">>> 请通过浏览器访问下载本地拉取一键安装包: $DownloadUrl" -ForegroundColor Cyan
`;

  return (
    <div className="min-h-screen bg-[#08090E] text-gray-300 font-sans flex">
      {/* ------------------------------------------------------------------------------
          左侧侧边导航
          ------------------------------------------------------------------------------ */}
      <aside className="w-64 border-r border-[#1F2437]/80 bg-[#11131E]/40 backdrop-blur-md flex flex-col p-6 sticky top-0 h-screen shrink-0">
        <div className="flex items-center gap-3 mb-10">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-[#1E40AF] to-[#8B5CF6] flex items-center justify-center shadow-lg shadow-[#1E40AF]/20">
            <Shield className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-white tracking-wide m-0 leading-none">Shield-Backup</h1>
            <span className="text-xs text-gray-500 tracking-wider">去中心化灾备中心</span>
          </div>
        </div>

        <nav className="flex-1 space-y-2">
          <button 
            onClick={() => setActiveTab('dashboard')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-300 text-sm font-medium ${activeTab === 'dashboard' ? 'bg-[#1F2437] text-white shadow-md border-l-4 border-[#1E40AF]' : 'hover:bg-[#11131E]/60 text-gray-400 hover:text-white'}`}
          >
            <LayoutDashboard className="w-5 h-5" />
            系统仪表盘
          </button>
          <button 
            onClick={() => setActiveTab('destinations')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-300 text-sm font-medium ${activeTab === 'destinations' ? 'bg-[#1F2437] text-white shadow-md border-l-4 border-[#1E40AF]' : 'hover:bg-[#11131E]/60 text-gray-400 hover:text-white'}`}
          >
            <CloudLightning className="w-5 h-5" />
            配置备份存储池
          </button>
          <button 
            onClick={() => setActiveTab('settings')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-300 text-sm font-medium ${activeTab === 'settings' ? 'bg-[#1F2437] text-white shadow-md border-l-4 border-[#1E40AF]' : 'hover:bg-[#11131E]/60 text-gray-400 hover:text-white'}`}
          >
            <Settings className="w-5 h-5" />
            全局备份设置
          </button>
        </nav>

        <div className="pt-6 border-t border-[#1F2437]/60">
          <div className="p-4 rounded-xl bg-[#11131E]/40 border border-[#1F2437]/40 text-center">
            <span className="text-xs text-gray-500 block mb-1">系统保护状态</span>
            <span className="text-xs font-semibold text-[#10B981] flex items-center justify-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-[#10B981] animate-pulse"></span>
              全局策略安全监控中
            </span>
          </div>
        </div>
      </aside>

      {/* ------------------------------------------------------------------------------
          主内容展示区
          ------------------------------------------------------------------------------ */}
      <main className="flex-1 p-8 lg:p-12 overflow-y-auto h-screen max-w-7xl">
        
        {/* ==============================================================================
            A. 仪表盘 Tab
            ============================================================================== */}
        {activeTab === 'dashboard' && (
          <div className="space-y-8 animate-fadeIn">
            <div className="flex justify-between items-start">
              <div>
                <h2 className="text-3xl font-bold text-white mb-2 font-mono">系统仪表盘</h2>
                <p className="text-gray-500">自动周期管理、无变更智能跳过以及全自动沙箱可用性报告。</p>
              </div>
            </div>



            {/* 手动触发控制区 */}
            <div className="glass-panel p-6 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
              <div className="space-y-2">
                <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                  <Shield className="w-5 h-5 text-[#1E40AF]" />
                  即时手动备份控制台
                </h3>
                <p className="text-sm text-gray-400">手动触发的备份将跳过无变更校验并强制打包执行。</p>
              </div>
              <div className="flex flex-wrap gap-4">
                <button 
                  onClick={() => triggerBackupNow('db')}
                  disabled={backupProgress !== null}
                  className="bg-[#1F2437] hover:bg-[#2A2F45] text-white border border-[#2e3451] px-5 py-3 rounded-xl transition-all text-sm font-semibold flex items-center gap-2"
                >
                  <Database className="w-4 h-4 text-[#8B5CF6]" />
                  备份核心数据库
                </button>
                <button 
                  onClick={() => triggerBackupNow('sys')}
                  disabled={backupProgress !== null}
                  className="bg-[#1E40AF] hover:bg-[#1E40AF]/80 text-white px-5 py-3 rounded-xl transition-all text-sm font-semibold flex items-center gap-2 shadow-lg shadow-[#1E40AF]/20"
                >
                  <FolderSync className="w-4 h-4 text-white" />
                  备份系统配置
                </button>
                <button 
                  onClick={() => triggerBackupNow('img')}
                  disabled={backupProgress !== null}
                  className="bg-[#11131E]/60 hover:bg-[#1F2437] text-white border border-[#1F2437] px-5 py-3 rounded-xl transition-all text-sm font-semibold flex items-center gap-2"
                >
                  <Layers className="w-4 h-4 text-[#3B82F6]" />
                  备份容器镜像
                </button>
              </div>
            </div>
            {/* 备份进度指示条 */}
            {backupProgress !== null && (
              <div className="glass-panel p-6 border-l-4 border-[#1E40AF] animate-slideDown">
                <div className="flex justify-between items-center mb-3 text-sm">
                  <span className="font-medium text-white">{backupStatusText}</span>
                  <span className="text-[#1E40AF] font-mono animate-pulse">执行中...</span>
                </div>
                <div className="w-full bg-[#1F2437] h-2 rounded-full overflow-hidden">
                  <div className="bg-gradient-to-r from-[#1E40AF] to-[#8B5CF6] h-full w-2/3 animate-pulse rounded-full"></div>
                </div>
              </div>
            )}



            {/* 灾备健康度验证报告卡片（沙箱校验展示） */}
            {healthReport && (
              <div className="glass-panel p-6 border-l-4 border-[#10B981] space-y-4">
                <div className="flex items-center justify-between border-b border-[#1F2437] pb-3">
                  <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                    <FileCheck className="w-5 h-5 text-[#10B981]" />
                    🔬 沙箱可用性报告
                  </h3>
                  <span className="text-xs text-gray-500 font-mono">
                    验证时间: {new Date(healthReport.time).toLocaleString()}
                  </span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="p-3 bg-[#11131E]/40 border border-[#1F2437]/40 rounded-xl space-y-1">
                    <span className="text-xs text-gray-500 block">检测文件对象</span>
                    <span className="text-sm font-semibold text-white truncate block font-mono" title={healthReport.backup_file}>
                      {healthReport.backup_file}
                    </span>
                  </div>
                  <div className="p-3 bg-[#11131E]/40 border border-[#1F2437]/40 rounded-xl space-y-1">
                    <span className="text-xs text-gray-500 block">解密与结构解压</span>
                    <span className={`text-sm font-semibold flex items-center gap-1.5 ${healthReport.decrypt_ok && healthReport.tar_ok ? 'text-[#10B981]' : 'text-red-500'}`}>
                      {healthReport.decrypt_ok && healthReport.tar_ok ? '通过 (OK)' : '异常'}
                    </span>
                  </div>
                  <div className="p-3 bg-[#11131E]/40 border border-[#1F2437]/40 rounded-xl space-y-1">
                    <span className="text-xs text-gray-500 block">数据库一致性 check</span>
                    <span className={`text-sm font-semibold ${healthReport.db_check_ok ? 'text-[#10B981]' : 'text-red-500'}`}>
                      {healthReport.db_check_msg}
                    </span>
                  </div>
                  <div className="p-3 bg-[#11131E]/40 border border-[#1F2437]/40 rounded-xl space-y-1">
                    <span className="text-xs text-gray-500 block">自建容器 Compose 配置</span>
                    <span className={`text-sm font-semibold truncate block ${healthReport.compose_ok ? 'text-[#10B981]' : 'text-red-500'}`} title={healthReport.compose_msg}>
                      {healthReport.compose_msg}
                    </span>
                  </div>
                </div>
                <div className="bg-[#10B981]/5 border border-[#10B981]/10 rounded-xl p-3.5 text-sm text-[#10B981] font-semibold flex items-center gap-2 font-mono">
                  <CheckCircle className="w-4 h-4 shrink-0" />
                  验证状态摘要：{healthReport.summary}
                </div>
              </div>
            )}

            {/* 指标卡片网格 */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* 数据库热备 (db_hourly) */}
              <div className="glass-panel p-6 space-y-4 flex flex-col justify-between bg-[#11131E]/20">
                <div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-500 font-semibold uppercase">数据库定时热备</span>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase ${
                      dbLastStatus === 'success' ? 'bg-[#10B981]/10 text-[#10B981]' :
                      dbLastStatus === 'skipped' ? 'bg-yellow-500/10 text-yellow-500' :
                      dbLastStatus === 'error' ? 'bg-red-500/10 text-red-500 font-mono' :
                      'bg-gray-500/10 text-gray-400'
                    }`}>
                      {dbLastStatus === 'success' ? '正常' :
                       dbLastStatus === 'skipped' ? '无变更(跳过)' :
                       dbLastStatus === 'error' ? '故障' : '等待中'}
                    </span>
                  </div>
                  <div className="text-xl font-bold text-white font-mono mt-3 tracking-wide">
                    {dbCountdown}
                  </div>
                </div>
                <div className="text-xs text-gray-500 border-t border-[#1F2437]/40 pt-3 space-y-1 font-mono">
                  <div>预计周期：{cronHoursDB}小时自动备份</div>
                  <div>上次开始：{dbLastStartTime > 0 ? new Date(dbLastStartTime * 1000).toLocaleString() : '无'}</div>
                  <div>上次结束：{dbLastEndTime > 0 ? new Date(dbLastEndTime * 1000).toLocaleString() : '无'}</div>
                  <div>运行耗时：{dbLastEndTime > dbLastStartTime ? (dbLastEndTime - dbLastStartTime) + ' 秒' : '0 秒'}</div>
                </div>
              </div>

              {/* 系统全量配置备份 (system_full) */}
              <div className="glass-panel p-6 space-y-4 flex flex-col justify-between bg-[#11131E]/20">
                <div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-500 font-semibold uppercase">系统全量配置备份</span>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase ${
                      sysLastStatus === 'success' ? 'bg-[#10B981]/10 text-[#10B981]' :
                      sysLastStatus === 'skipped' ? 'bg-yellow-500/10 text-yellow-500' :
                      sysLastStatus === 'error' ? 'bg-red-500/10 text-red-500 font-mono' :
                      'bg-gray-500/10 text-gray-400'
                    }`}>
                      {sysLastStatus === 'success' ? '正常' :
                       sysLastStatus === 'skipped' ? '无变更(跳过)' :
                       sysLastStatus === 'error' ? '故障' : '等待中'}
                    </span>
                  </div>
                  <div className="text-xl font-bold text-white font-mono mt-3 tracking-wide">
                    {sysCountdown}
                  </div>
                </div>
                <div className="text-xs text-gray-500 border-t border-[#1F2437]/40 pt-3 space-y-1 font-mono">
                  <div>预计周期：{cronHoursSys}小时自动备份</div>
                  <div>上次开始：{sysLastStartTime > 0 ? new Date(sysLastStartTime * 1000).toLocaleString() : '无'}</div>
                  <div>上次结束：{sysLastEndTime > 0 ? new Date(sysLastEndTime * 1000).toLocaleString() : '无'}</div>
                  <div>运行耗时：{sysLastEndTime > sysLastStartTime ? (sysLastEndTime - sysLastStartTime) + ' 秒' : '0 秒'}</div>
                </div>
              </div>

              {/* 本地客户端同步 (Local Pull Client) */}
              <div className="glass-panel p-6 space-y-4 flex flex-col justify-between bg-[#11131E]/20">
                <div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-500 font-semibold uppercase">本地同步冷备客户端</span>
                    <span className="text-[10px] bg-blue-500/10 text-blue-400 px-2 py-0.5 rounded-full font-bold uppercase">
                      GFS 自动淘汰中
                    </span>
                  </div>
                  <div className="text-xl font-bold text-white font-mono mt-3 tracking-wide">
                    {lastSyncTime > 0 ? new Date(lastSyncTime * 1000).toLocaleString() : '从未连接'}
                  </div>
                </div>
                <div className="text-xs text-gray-500 border-t border-[#1F2437]/40 pt-3 space-y-1 font-mono">
                  <div>同步状态：主控就绪</div>
                  <div>上次同步：{lastSyncTime > 0 ? '已同步' : '未连接'}</div>
                  <div>虚拟拉取清单数：{localPullList.length} 个文件</div>
                  <div>物理快照文件总数：{snapshotCount} 个文件</div>
                </div>
              </div>
            </div>

            {/* 云端存储池连通状况卡片 */}
            <div className="glass-panel p-6 space-y-6">
              <h3 className="text-lg font-semibold text-white">存储池连通健康状态</h3>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-6">
                <div className="p-4 rounded-xl bg-[#11131E]/40 border border-[#1F2437]/40 flex flex-col justify-between gap-3">
                  <span className="text-sm font-medium text-white">物理冷备 (Local)</span>
                  <span className="text-xs text-[#10B981] bg-[#10B981]/10 px-2.5 py-1 rounded-full font-semibold w-max">就绪</span>
                </div>
                <div className="p-4 rounded-xl bg-[#11131E]/40 border border-[#1F2437]/40 flex flex-col justify-between gap-3">
                  <span className="text-sm font-medium text-white">Telegram Bot</span>
                  {renderStatusBadge(telegramStatus)}
                </div>
                <div className="p-4 rounded-xl bg-[#11131E]/40 border border-[#1F2437]/40 flex flex-col justify-between gap-3">
                  <span className="text-sm font-medium text-white">OneDrive 云盘</span>
                  {renderStatusBadge(onedriveStatus)}
                </div>
                <div className="p-4 rounded-xl bg-[#11131E]/40 border border-[#1F2437]/40 flex flex-col justify-between gap-3">
                  <span className="text-sm font-medium text-white">Google Drive</span>
                  {renderStatusBadge(gdriveStatus)}
                </div>
                <div className="p-4 rounded-xl bg-[#11131E]/40 border border-[#1F2437]/40 flex flex-col justify-between gap-3">
                  <span className="text-sm font-medium text-white">PikPak (WebDAV)</span>
                  {renderStatusBadge(pikpakStatus)}
                </div>
              </div>
            </div>

            {/* 快照存储控制面板组件 */}
            <div className="glass-panel p-6 space-y-6">
              <div className="flex flex-col xl:flex-row justify-between xl:items-center gap-6 border-b border-[#1F2437] pb-6">
                <div>
                  <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                    <Layers className="w-5 h-5 text-[#8B5CF6]" />
                    快照存储控制面板
                  </h3>
                  <p className="text-xs text-gray-500 mt-1">切换不同存储池 Tab，支持跨池模糊搜索、按大小类型组合筛选与字段排序。</p>
                </div>
                {/* 5个存储池 Tabs 开关 */}
                <div className="flex flex-wrap bg-[#11131E] border border-[#1F2437]/80 rounded-xl p-1 text-sm font-medium">
                  <button 
                    onClick={() => setSnapshotSourceTab('local')}
                    className={`px-3.5 py-2 rounded-lg transition-all flex items-center gap-1 ${snapshotSourceTab === 'local' ? 'bg-[#1F2437] text-white font-semibold' : 'text-gray-400 hover:text-white'}`}
                  >
                    <Database className="w-3.5 h-3.5" />
                    服务器备份
                  </button>
                  <button 
                    onClick={() => setSnapshotSourceTab('telegram')}
                    className={`px-3.5 py-2 rounded-lg transition-all flex items-center gap-1 ${snapshotSourceTab === 'telegram' ? 'bg-[#1F2437] text-white font-semibold' : 'text-gray-400 hover:text-white'}`}
                  >
                    <CloudLightning className="w-3.5 h-3.5" />
                    Telegram
                  </button>
                  <button 
                    onClick={() => setSnapshotSourceTab('onedrive')}
                    className={`px-3.5 py-2 rounded-lg transition-all flex items-center gap-1 ${snapshotSourceTab === 'onedrive' ? 'bg-[#1F2437] text-white font-semibold' : 'text-gray-400 hover:text-white'}`}
                  >
                    <Cloud className="w-3.5 h-3.5" />
                    OneDrive
                  </button>
                  <button 
                    onClick={() => setSnapshotSourceTab('gdrive')}
                    className={`px-3.5 py-2 rounded-lg transition-all flex items-center gap-1 ${snapshotSourceTab === 'gdrive' ? 'bg-[#1F2437] text-white font-semibold' : 'text-gray-400 hover:text-white'}`}
                  >
                    <Cloud className="w-3.5 h-3.5" />
                    GDrive
                  </button>
                  <button 
                    onClick={() => setSnapshotSourceTab('pikpak')}
                    className={`px-3.5 py-2 rounded-lg transition-all flex items-center gap-1 ${snapshotSourceTab === 'pikpak' ? 'bg-[#1F2437] text-white font-semibold' : 'text-gray-400 hover:text-white'}`}
                  >
                    <FolderSync className="w-3.5 h-3.5" />
                    PikPak
                  </button>
                  <button 
                    onClick={() => setSnapshotSourceTab('local_pull')}
                    className={`px-3.5 py-2 rounded-lg transition-all flex items-center gap-1 ${snapshotSourceTab === 'local_pull' ? 'bg-[#1F2437] text-white font-semibold' : 'text-gray-400 hover:text-white'}`}
                  >
                    <FolderSync className="w-3.5 h-3.5 text-blue-400" />
                    本地冷备清单
                  </button>
                </div>
              </div>

              {/* 组合筛选过滤器面板 */}
              <div className="bg-[#11131E]/40 border border-[#1F2437]/40 p-4 rounded-xl flex flex-col md:flex-row flex-wrap gap-4 items-center text-xs">
                {/* 搜索 */}
                <div className="relative w-full md:w-64 shrink-0">
                  <input 
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="输入快照文件名模糊搜索..."
                    className="w-full bg-[#08090E] border border-[#1F2437]/80 rounded-lg pl-8 pr-3 py-2 text-white focus:outline-none focus:border-[#1E40AF] transition-all font-mono"
                  />
                  <Search className="w-4 h-4 text-gray-500 absolute left-2.5 top-2.5" />
                </div>

                {/* 类型 */}
                <div className="flex items-center gap-2">
                  <span className="text-gray-500">类型:</span>
                  <select 
                    value={filterType} 
                    onChange={(e: any) => setFilterType(e.target.value)}
                    className="bg-[#08090E] border border-[#1F2437]/80 rounded-lg px-2 py-1.5 text-white"
                  >
                    <option value="all">全部快照</option>
                    <option value="db">数据库热备 (db_hourly)</option>
                    <option value="sys">系统配置 (system)</option>
                  </select>
                </div>

                {/* 大小 */}
                <div className="flex items-center gap-2">
                  <span className="text-gray-500">文件大小:</span>
                  <select 
                    value={filterSize} 
                    onChange={(e: any) => setFilterSize(e.target.value)}
                    className="bg-[#08090E] border border-[#1F2437]/80 rounded-lg px-2 py-1.5 text-white"
                  >
                    <option value="all">全部大小</option>
                    <option value="small">小文件 (&lt; 1MB)</option>
                    <option value="medium">中等 (1MB - 10MB)</option>
                    <option value="large">大型 (10MB - 100MB)</option>
                    <option value="huge">极大型 (&gt; 100MB)</option>
                  </select>
                </div>

                {/* 时间 */}
                <div className="flex items-center gap-2">
                  <span className="text-gray-500">生成时间:</span>
                  <select 
                    value={filterDate} 
                    onChange={(e: any) => setFilterDate(e.target.value)}
                    className="bg-[#08090E] border border-[#1F2437]/80 rounded-lg px-2 py-1.5 text-white"
                  >
                    <option value="all">不限时间</option>
                    <option value="today">今天生成</option>
                    <option value="7d">最近 7 天</option>
                    <option value="30d">最近 30 天</option>
                  </select>
                </div>

                {/* 手动永久留档过滤 */}
                <div className="flex items-center gap-1.5 ml-3">
                  <input
                    type="checkbox"
                    id="filterKeepOnlyCheckbox"
                    checked={filterKeepOnly}
                    onChange={(e) => setFilterKeepOnly(e.target.checked)}
                    className="rounded border-[#1F2437] bg-[#08090E] text-[#1E40AF] focus:ring-0 cursor-pointer"
                  />
                  <label htmlFor="filterKeepOnlyCheckbox" className="text-gray-400 select-none cursor-pointer">
                    仅显示永久留档 (_keep_)
                  </label>
                </div>

                {/* 排序排序 */}
                <div className="flex items-center gap-2 ml-auto">
                  <span className="text-gray-500 flex items-center gap-1">
                    <ArrowUpDown className="w-3 h-3" />
                    排序:
                  </span>
                  <select 
                    value={sortBy} 
                    onChange={(e: any) => setSortBy(e.target.value)}
                    className="bg-[#08090E] border border-[#1F2437]/80 rounded-lg px-2 py-1.5 text-white"
                  >
                    <option value="time">按生成时间</option>
                    <option value="size">按文件大小</option>
                    <option value="name">按文件名称</option>
                  </select>
                  <select 
                    value={sortOrder} 
                    onChange={(e: any) => setSortOrder(e.target.value)}
                    className="bg-[#08090E] border border-[#1F2437]/80 rounded-lg px-2 py-1.5 text-white"
                  >
                    <option value="desc">降序</option>
                    <option value="asc">升序</option>
                  </select>
                </div>
              </div>

              {/* 批量操作提示条 */}
              {selectedPaths.length > 0 && (
                <div className="bg-[#1E40AF]/10 border border-[#1E40AF]/30 rounded-xl px-4 py-3 mb-4 flex items-center justify-between animate-fadeIn text-xs">
                  <div className="text-gray-300">
                    已选择 <span className="text-white font-bold">{selectedPaths.length}</span> 个加密快照包
                  </div>
                  <div className="space-x-3 flex items-center">
                    <button
                      onClick={handleBatchRestore}
                      className="text-xs bg-[#1E40AF]/20 hover:bg-[#1E40AF]/30 text-white border border-[#1E40AF]/40 px-3 py-1.5 rounded-lg transition-all font-semibold"
                    >
                      批量恢复数据库
                    </button>
                    <button
                      onClick={() => handleBatchArchive('keep')}
                      className="text-xs bg-yellow-500/20 hover:bg-yellow-500/30 text-yellow-400 border border-yellow-500/40 px-3 py-1.5 rounded-lg transition-all font-semibold"
                    >
                      🔒 批量永久留档
                    </button>
                    <button
                      onClick={() => handleBatchArchive('unkeep')}
                      className="text-xs bg-gray-500/20 hover:bg-gray-500/30 text-gray-400 border border-gray-500/40 px-3 py-1.5 rounded-lg transition-all font-semibold"
                    >
                      🔓 批量取消留档
                    </button>
                    <button
                      onClick={handleBatchDelete}
                      className="text-xs bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/40 px-3 py-1.5 rounded-lg transition-all font-semibold"
                    >
                      批量删除快照
                    </button>
                    <button
                      onClick={() => setSelectedPaths([])}
                      className="text-xs text-gray-400 hover:text-white transition-all underline"
                    >
                      取消选择
                    </button>
                  </div>
                </div>
              )}

              {/* 快照表格列表 */}
              {isLoadingSnapshots ? (
                <div className="py-12 text-center text-gray-500 flex items-center justify-center gap-3">
                  <RefreshCw className="w-5 h-5 animate-spin text-[#1E40AF]" />
                  正在拉取快照清单目录，请稍候...
                </div>
              ) : getFilteredAndSortedSnapshots().length === 0 ? (
                <div className="py-12 text-center text-gray-500 space-y-2">
                  <p>⚠️ 在此筛选配置或存储池中未检索到任何加密快照包。</p>
                  <p className="text-xs text-gray-600">若刚刚修改过配置或上传凭证，请点击手动备份。</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm border-collapse">
                    <thead>
                      <tr className="border-b border-[#1F2437] text-gray-500 text-xs">
                        <th className="pb-3 w-8">
                          <input
                            type="checkbox"
                            checked={getFilteredAndSortedSnapshots().length > 0 && selectedPaths.length === getFilteredAndSortedSnapshots().length}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedPaths(getFilteredAndSortedSnapshots().map(snap => snap.Path));
                              } else {
                                setSelectedPaths([]);
                              }
                            }}
                            className="rounded border-[#1F2437] bg-[#08090E] text-[#1E40AF] focus:ring-0 cursor-pointer"
                          />
                        </th>
                        <th className="pb-3 font-semibold uppercase tracking-wider">快照包名称 (Path)</th>
                        <th className="pb-3 font-semibold uppercase tracking-wider">包大小</th>
                        <th className="pb-3 font-semibold uppercase tracking-wider">备份时间</th>
                        <th className="pb-3 font-semibold uppercase tracking-wider text-right">操作动作</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#1F2437]/30">
                      {getFilteredAndSortedSnapshots().map((snap, idx) => (
                        <tr key={idx} className="hover:bg-[#11131E]/20 transition-colors">
                          <td className="py-4 w-8">
                            <input
                              type="checkbox"
                              checked={selectedPaths.includes(snap.Path)}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setSelectedPaths(prev => [...prev, snap.Path]);
                                } else {
                                  setSelectedPaths(prev => prev.filter(p => p !== snap.Path));
                                }
                              }}
                              className="rounded border-[#1F2437] bg-[#08090E] text-[#1E40AF] focus:ring-0 cursor-pointer"
                            />
                          </td>
                          <td className="py-4 font-mono font-medium text-white max-w-lg">
                            <div className="flex flex-col">
                              <span className="truncate block max-w-md" title={snap.Path}>{snap.Path}</span>
                              <div className="flex items-center gap-2 mt-1">
                                {labels[snap.Path.replace(/_keep_/g, '')] ? (
                                  <span className="text-[10px] bg-blue-500/10 text-blue-400 border border-blue-500/20 px-1.5 py-0.5 rounded font-sans">
                                    📌 {labels[snap.Path.replace(/_keep_/g, '')]}
                                  </span>
                                ) : null}
                                <button
                                  onClick={() => handleEditLabel(snap.Path.replace(/_keep_/g, ''), labels[snap.Path.replace(/_keep_/g, '')] || "")}
                                  className="text-[10px] text-gray-500 hover:text-white transition-all underline font-sans"
                                >
                                  编辑备注
                                </button>
                              </div>
                            </div>
                          </td>
                          <td className="py-4 text-gray-400 font-mono text-xs">
                            {formatBytes(snap.Size)}
                          </td>
                          <td className="py-4 text-gray-400 font-mono text-xs">
                            {new Date(snap.ModTime).toLocaleString()}
                          </td>
                          <td className="py-4 text-right space-x-3 shrink-0">
                            {/* 留档控制按钮：全部存储池通用支持 */}
                            {snap.Path.includes('_keep_') ? (
                              <button
                                onClick={() => handleArchiveSnapshot(snap.Path, 'unkeep')}
                                className="text-xs bg-gray-500/10 hover:bg-gray-500/20 text-gray-400 border border-gray-500/30 px-2.5 py-1.5 rounded-lg transition-all font-semibold inline-block align-middle"
                                title="取消永久留档（恢复 GFS 淘汰清理）"
                              >
                                🔓 取消留档
                              </button>
                            ) : (
                              <button
                                onClick={() => handleArchiveSnapshot(snap.Path, 'keep')}
                                className="text-xs bg-yellow-500/10 hover:bg-yellow-500/20 text-yellow-500 border border-yellow-500/30 px-2.5 py-1.5 rounded-lg transition-all font-semibold inline-block align-middle"
                                title="转换永久留档（免除 GFS 淘汰清理）"
                              >
                                🔒 永久留档
                              </button>
                            )}

                            {snapshotSourceTab === 'local_pull' ? (
                              <button 
                                onClick={() => handleDeleteLocalPullSnapshot(snap.Path)}
                                className="text-xs bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/30 px-3 py-1.5 rounded-lg transition-all font-semibold inline-block align-middle"
                              >
                                从清单移出
                              </button>
                            ) : (
                              <>
                                <button 
                                  onClick={() => handleRestoreSnapshot(snap.Path)}
                                  className="text-xs bg-[#1E40AF]/10 hover:bg-[#1E40AF]/20 text-[#1E40AF] border border-[#1E40AF]/30 px-3 py-1.5 rounded-lg transition-all font-semibold inline-block align-middle"
                                >
                                  一键恢复
                                </button>

                                {snapshotSourceTab === 'local' ? (
                                  <select
                                    onChange={(e) => {
                                      if (e.target.value) {
                                        handleTransferSnapshot(snap.Path, e.target.value);
                                        e.target.value = '';
                                      }
                                    }}
                                    className="text-xs bg-[#08090E] text-gray-300 border border-[#1F2437] rounded-lg px-2 py-1.5 cursor-pointer focus:outline-none font-semibold inline-block align-middle"
                                    defaultValue=""
                                  >
                                    <option value="" disabled>分发上传到...</option>
                                    <option value="telegram">Telegram Bot</option>
                                    <option value="onedrive">OneDrive</option>
                                    <option value="gdrive">Google Drive</option>
                                    <option value="pikpak">PikPak</option>
                                    <option value="local_pull">本地冷备客户端虚拟清单</option>
                                  </select>
                                ) : (
                                  <button
                                    onClick={() => handleTransferSnapshot(snap.Path, 'local')}
                                    className="text-xs bg-green-500/10 hover:bg-green-500/20 text-green-500 border border-green-500/30 px-3 py-1.5 rounded-lg transition-all font-semibold inline-block align-middle"
                                  >
                                    拉取到服务器
                                  </button>
                                )}

                                <button 
                                  onClick={() => handleDeleteSnapshot(snap.Path)}
                                  className="text-xs bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/30 p-1.5 rounded-lg transition-all inline-block align-middle"
                                  title="彻底删除快照"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* 全局任务监控大厅 (Live Task Manager) */}
            <div className="glass-panel p-6 space-y-4">
              <div className="flex items-center justify-between border-b border-[#1F2437] pb-3">
                <div className="flex items-center gap-2.5">
                  <span className={`w-2.5 h-2.5 rounded-full ${tasks.some(t => t.status === 'running') ? 'bg-blue-500 animate-pulse' : 'bg-gray-500'}`}></span>
                  <h3 className="text-lg font-semibold text-white">
                    📟 备份与数据传输任务管理器 (Live Task Manager)
                  </h3>
                </div>
              </div>

              <div className="space-y-6">
                {/* 活跃任务列表 */}
                <div className="space-y-3">
                  <span className="text-xs text-gray-500 font-bold uppercase tracking-wider block">当前活动进程监控</span>
                  {tasks.filter(t => t.status === 'running' || t.status === 'paused').length === 0 ? (
                    <div className="text-xs text-gray-600 font-mono py-2 italic">暂无正在运行或挂起的活跃任务。</div>
                  ) : (
                    <div className="space-y-4">
                      {tasks.filter(t => t.status === 'running' || t.status === 'paused').map((t, idx) => {
                        const isExpanded = !!expandedTaskIds[t.task_id];
                        return (
                          <div key={idx} className="p-4 rounded-xl bg-[#11131E]/60 border border-[#1F2437] space-y-3">
                            <div className="flex justify-between items-center text-xs">
                              <div className="flex items-center gap-2">
                                <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase ${t.type.includes('backup') ? 'bg-blue-500/10 text-blue-400' : 'bg-purple-500/10 text-purple-400'}`}>
                                  {t.type === 'db_backup' ? '数据库打包' : t.type === 'sys_backup' ? '系统打包' : t.type === 'upload' ? '云端分发' : t.type === 'download' ? '拉取快照' : t.type === 'cold_download' ? '冷备下载' : '任务同步'}
                                </span>
                                <span className="font-semibold text-white font-mono">{t.name}</span>
                              </div>
                              <div className="flex items-center gap-4 text-gray-500 font-mono">
                                <span>速度: <strong className="text-white font-bold">{t.speed || '-'}</strong></span>
                                <span>ETA: <strong className="text-white font-bold">{t.eta || '-'}</strong></span>
                                <span>进度: <strong className="text-blue-400 font-bold">{t.progress}%</strong></span>
                              </div>
                            </div>
                            <div className="w-full bg-[#08090E] rounded-full h-1.5 overflow-hidden">
                              <div className="bg-blue-500 h-1.5 rounded-full transition-all duration-300" style={{ width: `${t.progress}%` }}></div>
                            </div>
                            <div className="flex justify-between items-center text-[10px] text-gray-500">
                              <button 
                                onClick={() => toggleTaskExpand(t.task_id)}
                                className="hover:text-white transition-colors"
                              >
                                {isExpanded ? 'Collapse 隐藏详情 ▲' : 'Details 展开详情 ▼'}
                              </button>
                              <div className="flex gap-2">
                                <button 
                                  onClick={() => handleControlTask(t.task_id, t.status === 'running' ? 'pause' : 'resume')}
                                  className={`px-2.5 py-1 rounded border ${t.status === 'running' ? 'border-yellow-500/30 text-yellow-500/80 hover:bg-yellow-500/10' : 'border-green-500/30 text-green-500/80 hover:bg-green-500/10'} transition-all`}
                                >
                                  {t.status === 'running' ? '暂停' : '恢复'}
                                </button>
                                <button 
                                  onClick={() => handleControlTask(t.task_id, 'kill')}
                                  className="px-2.5 py-1 rounded border border-red-500/30 text-red-500/80 hover:bg-red-500/10 transition-all"
                                >
                                  终止
                                </button>
                              </div>
                            </div>
                            {isExpanded && (
                              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-[10px] text-gray-400 font-mono bg-[#08090E]/40 p-3 rounded-lg border border-[#1F2437]/40">
                                <div>
                                  <span className="text-gray-600 block mb-0.5">任务唯一标识 (ID)</span>
                                  <span className="text-white select-all">{t.task_id}</span>
                                </div>
                                <div>
                                  <span className="text-gray-600 block mb-0.5">备份触发机制</span>
                                  <span className="text-white">{t.trigger === 'manual' ? '🟢 手动触发' : '⏰ 自动定时计划'}</span>
                                </div>
                                <div>
                                  <span className="text-gray-600 block mb-0.5">已归档物理备份包</span>
                                  <span className="text-blue-400 font-semibold break-all">{t.backup_file || '无 / 临时包'}</span>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* 历史任务列表 */}
                <div className="space-y-3 pt-3 border-t border-[#1F2437]/60">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-500 font-bold uppercase tracking-wider block">任务执行历史简报</span>
                    <button
                      type="button"
                      onClick={() => setIsHistoryCollapsed(!isHistoryCollapsed)}
                      className="text-[10px] text-gray-500 hover:text-white border border-[#1F2437] px-2.5 py-1.5 rounded-lg bg-[#11131E]/50 font-mono transition-all"
                    >
                      {isHistoryCollapsed ? '展开历史 (' + tasks.length + ')' : '折叠历史 (' + filteredTasks.length + '/' + tasks.length + ')'}
                    </button>
                  </div>

                  {/* 新增：任务历史复合筛选面板 */}
                  {!isHistoryCollapsed && (
                    <div className="glass-panel p-4 space-y-4 bg-[#11131E]/40 border border-[#1F2437]/60 rounded-xl animate-fadeIn">
                      <div className="flex justify-between items-center border-b border-[#1F2437]/40 pb-2">
                        <span className="text-xs text-white font-semibold flex items-center gap-1.5">
                          🔍 任务历史复合检索工具
                        </span>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-gray-400 font-mono">
                            匹配: <strong className="text-blue-400 font-bold">{filteredTasks.length}</strong> / 共 {tasks.length} 条
                          </span>
                          <button
                            onClick={() => {
                              setFilterActionTypes([]);
                              setFilterTaskName('');
                              setFilterTrigger('all');
                              setFilterTimeRange('all');
                              setFilterTaskStatus('all');
                            }}
                            className="text-[10px] text-red-400 hover:text-red-300 font-mono underline transition-colors"
                          >
                            重置筛选
                          </button>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-xs font-mono">
                        {/* 1. 文本搜索 */}
                        <div className="space-y-1.5 md:col-span-2">
                          <span className="text-gray-500 block text-[10px] uppercase">搜索任务名/ID/物理包名</span>
                          <input
                            type="text"
                            value={filterTaskName}
                            onChange={(e) => setFilterTaskName(e.target.value)}
                            placeholder="支持模糊检索名称、ID或备份文件名"
                            className="w-full bg-[#08090E] border border-[#1F2437] rounded-lg px-3 py-2 text-white focus:outline-none focus:border-[#1E40AF] transition-all"
                          />
                        </div>

                        {/* 2. 触发方式 */}
                        <div className="space-y-1.5">
                          <span className="text-gray-500 block text-[10px] uppercase">触发源筛选</span>
                          <select
                            value={filterTrigger}
                            onChange={(e) => setFilterTrigger(e.target.value as any)}
                            className="w-full bg-[#08090E] border border-[#1F2437] rounded-lg px-3 py-2 text-white focus:outline-none focus:border-[#1E40AF]"
                          >
                            <option value="all">🟢 全部触发源</option>
                            <option value="manual">👤 手动执行</option>
                            <option value="cron">⏰ 定时计划</option>
                          </select>
                        </div>

                        {/* 3. 状态 */}
                        <div className="space-y-1.5">
                          <span className="text-gray-500 block text-[10px] uppercase">任务最终状态</span>
                          <select
                            value={filterTaskStatus}
                            onChange={(e) => setFilterTaskStatus(e.target.value as any)}
                            className="w-full bg-[#08090E] border border-[#1F2437] rounded-lg px-3 py-2 text-white focus:outline-none focus:border-[#1E40AF]"
                          >
                            <option value="all">🔘 全部状态</option>
                            <option value="success">✅ SUCCESS (成功)</option>
                            <option value="error">❌ ERROR (失败)</option>
                            <option value="killed">⚠️ KILLED (终止)</option>
                          </select>
                        </div>

                        {/* 4. 时间范围 */}
                        <div className="space-y-1.5">
                          <span className="text-gray-500 block text-[10px] uppercase">执行时间范围</span>
                          <select
                            value={filterTimeRange}
                            onChange={(e) => setFilterTimeRange(e.target.value as any)}
                            className="w-full bg-[#08090E] border border-[#1F2437] rounded-lg px-3 py-2 text-white focus:outline-none focus:border-[#1E40AF]"
                          >
                            <option value="all">📅 所有历史数据</option>
                            <option value="today">🕒 仅今日</option>
                            <option value="7d">📅 最近 7 天</option>
                            <option value="30d">📅 最近 30 天</option>
                          </select>
                        </div>

                        {/* 5. 动作类型多选 */}
                        <div className="space-y-2 md:col-span-3">
                          <span className="text-gray-500 block text-[10px] uppercase">动作类型多选 (可多选，不选默认为全部)</span>
                          <div className="flex flex-wrap gap-2 pt-0.5">
                            {[
                              { type: 'db_backup', label: '数据库打包' },
                              { type: 'sys_backup', label: '系统配置打包' },
                              { type: 'upload', label: '云端分发上传' },
                              { type: 'download', label: '拉取云端快照' },
                              { type: 'sync', label: '备份同步/命名' },
                              { type: 'cold_download', label: '客户端冷备下载' }
                            ].map((item) => {
                              const isActive = filterActionTypes.includes(item.type);
                              return (
                                <button
                                  key={item.type}
                                  type="button"
                                  onClick={() => {
                                    if (isActive) {
                                      setFilterActionTypes(filterActionTypes.filter(t => t !== item.type));
                                    } else {
                                      setFilterActionTypes([...filterActionTypes, item.type]);
                                    }
                                  }}
                                  className={`px-2.5 py-1 rounded-lg border transition-all text-[11px] cursor-pointer ${
                                    isActive 
                                      ? 'bg-blue-500/20 border-blue-500 text-blue-300 font-bold shadow-md shadow-blue-500/5' 
                                      : 'bg-transparent border-[#1F2437] text-gray-500 hover:border-gray-500/50 hover:text-gray-300'
                                  }`}
                                >
                                  {item.label}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {tasks.length === 0 ? (
                    <div className="text-xs text-gray-600 font-mono py-2 italic">暂无历史任务简报。</div>
                  ) : (
                    !isHistoryCollapsed && (
                      <div className="overflow-x-auto border border-[#1F2437]/40 rounded-xl bg-[#08090E]/30 animate-slideDown">
                        <table className="w-full text-left text-xs border-collapse font-mono">
                          <thead>
                            <tr className="border-b border-[#1F2437] bg-[#11131E]/40 text-gray-400 font-semibold">
                              <th className="p-3">任务名</th>
                              <th className="p-3">动作类型</th>
                              <th className="p-3">开始时间</th>
                              <th className="p-3">执行耗时</th>
                              <th className="p-3">状态</th>
                              <th className="p-3 text-right">错误简报</th>
                            </tr>
                          </thead>
                          <tbody>
                            {filteredTasks.slice(0, taskHistoryLimit).map((t, idx) => {
                              const isExpanded = !!expandedTaskIds[t.task_id];
                              return (
                                <Fragment key={idx}>
                                  <tr className="border-b border-[#1F2437]/40 hover:bg-white/5 transition-colors cursor-pointer" onClick={() => toggleTaskExpand(t.task_id)}>
                                    <td className="p-3 font-semibold text-white">{t.name}</td>
                                    <td className="p-3">
                                      {t.type === 'db_backup' ? '数据库打包' : t.type === 'sys_backup' ? '系统打包' : t.type === 'upload' ? '云端分发' : t.type === 'download' ? '拉取快照' : t.type === 'cold_download' ? '冷备下载' : '任务同步'}
                                    </td>
                                    <td className="p-3">{new Date(t.start_time).toLocaleString()}</td>
                                    <td className="p-3">{t.elapsed_time || '0秒'}</td>
                                    <td className="p-3">
                                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                        t.status === 'success' ? 'bg-[#10B981]/10 text-[#10B981]' :
                                        t.status === 'killed' ? 'bg-yellow-500/10 text-yellow-500' :
                                        t.status === 'running' ? 'bg-blue-500/10 text-blue-400 animate-pulse' :
                                        t.status === 'paused' ? 'bg-yellow-600/10 text-yellow-500 animate-pulse' :
                                        'bg-red-500/10 text-red-500'
                                      }`}>
                                        {t.status === 'success' ? 'SUCCESS' : 
                                         t.status === 'killed' ? 'KILLED' : 
                                         t.status === 'running' ? 'RUNNING' : 
                                         t.status === 'paused' ? 'PAUSED' : 'ERROR'}
                                      </span>
                                    </td>
                                    <td className="p-3 text-right text-red-400/80 font-sans max-w-xs truncate" title={t.error_msg || ''}>
                                      {t.error_msg || '-'}
                                    </td>
                                  </tr>
                                  {isExpanded && (
                                    <tr className="bg-[#11131E]/40">
                                      <td colSpan={6} className="p-4 border-t border-b border-[#1F2437]/60">
                                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-xs text-gray-400 font-mono">
                                          <div>
                                            <span className="text-gray-600 block mb-1">任务唯一标识 (ID)</span>
                                            <span className="text-white select-all">{t.task_id}</span>
                                          </div>
                                          <div>
                                            <span className="text-gray-600 block mb-1">备份触发机制</span>
                                            <span className="text-white">{t.trigger === 'manual' ? '🟢 手动触发' : '⏰ 自动定时计划'}</span>
                                          </div>
                                          <div>
                                            <span className="text-gray-600 block mb-1">已归档物理备份包</span>
                                            <span className="text-blue-400 font-semibold break-all">{t.backup_file || '无 / 临时包'}</span>
                                          </div>
                                          <div>
                                            <span className="text-gray-600 block mb-1">任务启动时间</span>
                                            <span className="text-white">{new Date(t.start_time).toLocaleString()}</span>
                                          </div>
                                          <div>
                                            <span className="text-gray-600 block mb-1">完成归档时间</span>
                                            <span className="text-white">{t.end_time ? new Date(t.end_time).toLocaleString() : '异常退出'}</span>
                                          </div>
                                          <div>
                                            <span className="text-gray-600 block mb-1">执行物理用时</span>
                                            <span className="text-white">{t.elapsed_time}</span>
                                          </div>
                                          {t.error_msg && (
                                            <div className="col-span-1 md:col-span-3 space-y-1 mt-2">
                                              <span className="text-red-400 font-bold block">🚨 后端运行捕获异常报告</span>
                                              <pre className="w-full bg-red-950/20 border border-red-500/20 text-red-400 p-3 rounded-lg text-[11px] leading-relaxed overflow-x-auto whitespace-pre-wrap select-all text-left font-mono">
                                                {t.error_msg}
                                              </pre>
                                            </div>
                                          )}
                                        </div>
                                      </td>
                                    </tr>
                                  )}
                                </Fragment>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )
                  )}
                </div>
              </div>
            </div>

            {/* 后台系统实时监控日志看板 */}
            <div className="glass-panel p-6 space-y-4 bg-[#11131E]/20">
              <div className="flex justify-between items-center border-b border-[#1F2437]/60 pb-3">
                <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#10B981] animate-pulse"></span>
                  📟 远程 VPS 服务端实时监控终端 (Live Logs)
                </h3>
                <div className="flex items-center gap-3">
                  <label className="text-xs text-gray-400 font-mono flex items-center gap-1.5 cursor-pointer select-none">
                    <input 
                      type="checkbox" 
                      checked={enableLiveLogsScroll} 
                      onChange={(e) => setEnableLiveLogsScroll(e.target.checked)}
                      className="rounded bg-[#08090E] border-[#1F2437] text-[#1E40AF] focus:ring-[#1E40AF] focus:ring-offset-0 focus:outline-none w-3.5 h-3.5"
                    />
                    滚动刷新
                  </label>
                  <span className="text-xs text-gray-500 font-mono">
                    ({enableLiveLogsScroll ? '智能滚动防拽' : '已暂停'})
                  </span>
                </div>
              </div>
              
              <div 
                ref={logContainerRef} 
                onScroll={handleLogScroll}
                className="bg-[#08090E]/60 border border-[#1F2437] rounded-xl p-4 font-mono text-xs text-gray-400 h-80 overflow-y-auto leading-relaxed text-left"
              >
                {liveLogs.length === 0 ? (
                  <div className="text-center py-6 text-gray-600">正在等待日志上报，或当前无活跃运行日志...</div>
                ) : (
                  (() => {
                    const totalCount = liveLogs.length;
                    const startIndex = Math.max(0, Math.floor(logScrollTop / ITEM_HEIGHT) - BUFFER);
                    const endIndex = Math.min(totalCount, Math.floor((logScrollTop + 320) / ITEM_HEIGHT) + BUFFER);
                    const visibleLogs = liveLogs.slice(startIndex, endIndex);
                    const paddingTop = startIndex * ITEM_HEIGHT;
                    const paddingBottom = Math.max(0, (totalCount - endIndex) * ITEM_HEIGHT);

                    return (
                      <div style={{ paddingTop: `${paddingTop}px`, paddingBottom: `${paddingBottom}px`, position: 'relative' }}>
                        {visibleLogs.map((line, relativeIdx) => {
                          const idx = startIndex + relativeIdx;
                          let element = <span>{line}</span>;
                          if (line.includes('[INFO]')) {
                            element = <span className="text-blue-400">{line}</span>;
                          } else if (line.includes('[SUCCESS]')) {
                            element = <span className="text-[#10B981] font-semibold">{line}</span>;
                          } else if (line.includes('[ERROR]')) {
                            element = <span className="text-red-500 font-semibold">{line}</span>;
                          } else if (line.includes('[WARN]') || line.includes('[WARNING]')) {
                            element = <span className="text-yellow-500">{line}</span>;
                          } else if (line.includes('[VERIFY]')) {
                            element = <span className="text-purple-400 font-semibold">{line}</span>;
                          } else if (line.includes('[SCHEDULER]')) {
                            element = <span className="text-indigo-400">{line}</span>;
                          } else if (line.includes('[DEDUPLICATION]')) {
                            element = <span className="text-teal-400">{line}</span>;
                          } else if (line.includes('[RCLONE]')) {
                            element = <span className="text-orange-400">{line}</span>;
                          }
                          return (
                            <div 
                              key={idx} 
                              style={{ height: `${ITEM_HEIGHT}px` }} 
                              className="py-0.5 hover:bg-white/5 transition-colors font-mono overflow-hidden whitespace-nowrap text-ellipsis"
                            >
                              {element}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()
                )}
              </div>
            </div>

            {/* 本地冷备下载工具链与解密指引 */}
            <div className="glass-panel p-6 space-y-4 bg-[#11131E]/20">
              <div className="flex justify-between items-center border-b border-[#1F2437]/60 pb-3 cursor-pointer" onClick={() => setIsToolboxCollapsed(!isToolboxCollapsed)}>
                <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                  <Download className="w-5 h-5 text-[#8B5CF6]" />
                  📥 本地冷备客户端一键同步下载工具链 & 解密还原指引
                </h3>
                <span className="text-xs text-gray-400 hover:text-white transition-all underline select-none">
                  {isToolboxCollapsed ? '展开工具箱' : '折叠隐藏'}
                </span>
              </div>

              {!isToolboxCollapsed && (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 pt-2 animate-fadeIn">
                  {/* 同步设定 */}
                  <div className="lg:col-span-7 space-y-4">
                    <div className="flex items-center gap-3">
                      <div className="p-2.5 rounded-xl bg-[#1E40AF]/10 border border-[#1E40AF]/30 text-[#1E40AF]">
                        <FolderSync className="w-4 h-4" />
                      </div>
                      <div>
                        <h4 className="text-sm font-semibold text-white">步骤一：设定并安装服务器备份本地冷备同步</h4>
                        <p className="text-[11px] text-gray-500">已免除本地 Rclone 安装，自动拉取最新快照，并按照 GFS 保留策略自适应删除过期备份。</p>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <div className="space-y-1">
                        <label className="text-[11px] text-gray-400 font-semibold uppercase">本地保存绝对路径</label>
                        <input 
                          type="text"
                          value={localPullPath}
                          onChange={(e) => setLocalPullPath(e.target.value)}
                          className="w-full bg-[#08090E] border border-[#1F2437] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-[#1E40AF] transition-all font-mono"
                          placeholder="例: D:\\Backup\\VPS_Backup"
                        />
                      </div>

                      <div className="space-y-1">
                        <label className="text-[11px] text-gray-400 font-semibold uppercase">本地拉取安全 Token</label>
                        <div className="flex items-center gap-2">
                          <div className="flex-1 bg-[#08090E] border border-[#1F2437] rounded-lg px-3 py-2 text-xs font-mono text-white flex items-center justify-between">
                            <span className="select-all">{showToken ? downloadToken : '••••••••••••••••••••••••••••••••'}</span>
                            <button
                              type="button"
                              onClick={() => setShowToken(!showToken)}
                              className="text-gray-500 hover:text-white transition-colors pl-2"
                            >
                              {showToken ? '隐藏' : '显示'}
                            </button>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              navigator.clipboard.writeText(downloadToken);
                              showToast("Token 已成功复制到剪贴板！", "success");
                            }}
                            className="bg-[#1F2437] hover:bg-[#2A2F45] border border-[#2e3451] px-3 py-2 rounded-lg text-xs font-semibold text-white transition-all whitespace-nowrap"
                          >
                            复制
                          </button>
                          <button
                            type="button"
                            onClick={handleRefreshToken}
                            className="bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 px-3 py-2 rounded-lg text-xs font-semibold text-red-400 transition-all whitespace-nowrap"
                          >
                            🔄 重置 Token
                          </button>
                        </div>
                      </div>
                      
                      <div className="relative">
                        <pre className="bg-[#08090E] border border-[#1F2437] rounded-lg p-3 text-[10px] font-mono text-gray-400 overflow-x-auto leading-normal max-h-36 whitespace-pre text-left">
                          {dynamicPsScript}
                        </pre>
                      </div>

                      <a 
                        href={`/api/local-pull/download-zip?token=${downloadToken}&path=${encodeURIComponent(localPullPath)}`}
                        className="w-full bg-[#1E40AF] hover:bg-[#1E40AF]/80 text-white px-4 py-2.5 rounded-lg transition-all text-xs font-semibold flex items-center justify-center gap-2 shadow-lg shadow-[#1E40AF]/20"
                      >
                        <Download className="w-3.5 h-3.5 text-white" />
                        下载拉取助手一键安装包 (ZIP)
                      </a>

                      <div className="space-y-1.5 text-[11px] text-gray-400 font-mono">
                        <span className="font-semibold text-white block">⚙️ 本地配置指引：</span>
                        <p>1. 点击上方按钮下载压缩包，并解压到一个您常用的本地硬盘文件夹中。</p>
                        <p>2. 双击运行 `setup_task.ps1` 脚本，此脚本需要管理员权限，会自动在 Windows 中注册一个名为 `ShieldBackupSyncTask` 的每日任务。</p>
                        <p className="text-[#F59E0B] bg-[#F59E0B]/10 border border-[#F59E0B]/20 p-2.5 rounded-lg leading-relaxed">
                          ⚠️ **安全警告**：一键拉取包内含您的安全 API Token (私密下载钥匙)。请务必妥善保管，严禁与他人分享！如果 Token 被重置，请回到此页面重新下载配置。
                        </p>
                      </div>

                      {/* 客户端同步心跳历史记录板块 */}
                      <div className="border border-[#1F2437]/40 rounded-xl p-4 space-y-3 bg-[#11131E]/20">
                        <div className="flex items-center justify-between cursor-pointer select-none" onClick={() => setIsPullLogsCollapsed(!isPullLogsCollapsed)}>
                          <span className="text-xs font-bold text-white uppercase font-mono flex items-center gap-2">
                            <span className={`w-2 h-2 rounded-full ${localPullLogs && localPullLogs.length > 0 ? 'bg-[#10B981] animate-pulse' : 'bg-gray-500'}`}></span>
                            📂 客户端最后拉取记录流水
                          </span>
                          <span className="text-[10px] text-gray-500 hover:text-white transition-all">
                            {isPullLogsCollapsed ? '展开历史 ▼' : '折叠历史 ▲'}
                          </span>
                        </div>

                        {!isPullLogsCollapsed && (
                          <div className="space-y-2 animate-slideDown">
                            {(!localPullLogs || localPullLogs.length === 0) ? (
                              <div className="text-[10px] text-gray-500 font-mono italic">暂无本地客户端同步记录。</div>
                            ) : (
                              <div className="overflow-x-auto rounded-lg border border-[#1F2437]/40">
                                <table className="w-full text-left text-[10px] border-collapse font-mono">
                                  <thead>
                                    <tr className="border-b border-[#1F2437] bg-[#11131E]/40 text-gray-500 font-semibold">
                                      <th className="p-2">时间</th>
                                      <th className="p-2">客户端 IP</th>
                                      <th className="p-2">文件数</th>
                                      <th className="p-2">新增下载</th>
                                      <th className="p-2">淘汰删除</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-[#1F2437]/20 text-gray-300">
                                    {localPullLogs.map((log, idx) => (
                                      <tr key={idx} className="hover:bg-white/5">
                                        <td className="p-2 whitespace-nowrap">{new Date(log.Time || log.time).toLocaleString()}</td>
                                        <td className="p-2">{log.IP || log.ip}</td>
                                        <td className="p-2">{log.FileCount || log.file_count}</td>
                                        <td className="p-2 text-green-400 font-semibold">+{log.Downloads || log.downloads}</td>
                                        <td className="p-2 text-red-400 font-semibold">-{log.Deletes || log.deletes}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* 离线解密 */}
                  <div className="lg:col-span-5 space-y-4">
                    <div className="flex items-center gap-3">
                      <div className="p-2.5 rounded-xl bg-[#8B5CF6]/10 border border-[#8B5CF6]/30 text-[#8B5CF6]">
                        <Lock className="w-4 h-4" />
                      </div>
                      <div>
                        <h4 className="text-sm font-semibold text-white">步骤二：离线一键解密还原</h4>
                        <p className="text-[11px] text-gray-500">脱离控制面板与任何网络进行离线完全还原。</p>
                      </div>
                    </div>
                    <div className="text-[11px] text-gray-400 space-y-3.5 leading-relaxed font-mono">
                      <p>当云端和控制中心遭遇毁灭性灾难时，请不要惊慌！</p>
                      <p>您在服务器备份中保存的所有 `.enc` 快照包都是完备且强加密的。将快照文件放置在任何支持 `openssl` 的终端下（Windows Git Bash 或 Linux），运行以下指令即可实现完全脱机离线瞬间解密还原：</p>
                      <pre className="bg-[#08090E] border border-[#1F2437] rounded-lg p-2.5 font-mono text-white whitespace-pre-wrap text-left text-[10px]">
                        openssl enc -d -aes-256-cbc -salt -pbkdf2 -in {"<加密包文件名>"} -out decrypted_backup.tar.gz
                      </pre>
                      <p>随后解压缩 `decrypted_backup.tar.gz` 即可。这保障了极端状况下您对核心资产的终极自主权与知情权！</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ==============================================================================
            B. 存储池配置 Tab
            ============================================================================== */}
        {activeTab === 'destinations' && (
          <div className="space-y-8 animate-fadeIn">
            <div>
              <h2 className="text-3xl font-bold text-white mb-2 font-mono">配置备份存储池</h2>
              <p className="text-gray-500">完成云盘授权凭证或第三方 WebDAV 的一键对接与同步。</p>
            </div>

            {/* 云盘 Tab */}
            <div className="flex border-b border-[#1F2437] gap-6 text-sm">
              <button 
                onClick={() => setActiveDest('telegram')}
                className={`pb-4 px-2 font-medium transition-all ${activeDest === 'telegram' ? 'border-b-2 border-[#1E40AF] text-white font-semibold' : 'text-gray-500 hover:text-white'}`}
              >
                Telegram Bot机器人
              </button>
              <button 
                onClick={() => setActiveDest('onedrive')}
                className={`pb-4 px-2 font-medium transition-all ${activeDest === 'onedrive' ? 'border-b-2 border-[#1E40AF] text-white font-semibold' : 'text-gray-500 hover:text-white'}`}
              >
                微软 OneDrive 云盘
              </button>
              <button 
                onClick={() => setActiveDest('gdrive')}
                className={`pb-4 px-2 font-medium transition-all ${activeDest === 'gdrive' ? 'border-b-2 border-[#1E40AF] text-white font-semibold' : 'text-gray-500 hover:text-white'}`}
              >
                Google Drive 谷歌盘
              </button>
              <button 
                onClick={() => setActiveDest('pikpak')}
                className={`pb-4 px-2 font-medium transition-all ${activeDest === 'pikpak' ? 'border-b-2 border-[#1E40AF] text-white font-semibold' : 'text-gray-500 hover:text-white'}`}
              >
                PikPak 原生同步
              </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
              {/* 左侧指引 */}
              <div className="lg:col-span-6 glass-panel p-6 space-y-6 bg-[#11131E]/20 border border-[#1F2437]/40">
                <div className="flex items-center gap-2.5">
                  <HelpCircle className="w-5 h-5 text-[#1E40AF]" />
                  <h3 className="text-lg font-semibold text-white">{DESTINATION_GUIDES[activeDest].title}</h3>
                </div>
                
                <ol className="space-y-4 list-decimal pl-5 text-sm leading-relaxed text-gray-400 font-mono">
                  {DESTINATION_GUIDES[activeDest].steps.map((step, idx) => (
                    <li key={idx} className="marker:text-[#1E40AF] marker:font-semibold">
                      {step}
                    </li>
                  ))}
                </ol>
              </div>

              {/* 右侧表单 */}
              <div className="lg:col-span-6 glass-panel p-6 space-y-6">
                <h3 className="text-lg font-semibold text-white">存储池授权凭证参数</h3>

                {activeDest === 'telegram' && (
                  <div className="space-y-4">
                    <div className="space-y-2">
                  <label className="text-xs text-gray-400 font-semibold uppercase">TELEGRAM BOT TOKEN</label>
                      <input 
                        type="password" 
                        value={tgToken}
                        onChange={(e) => setTgToken(e.target.value)}
                        className="w-full bg-[#08090E] border border-[#1F2437] rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-[#1E40AF] transition-all font-mono"
                        placeholder="请输入您的 Bot API Token"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs text-gray-400 font-semibold uppercase">TELEGRAM CHAT ID</label>
                      <input 
                        type="text" 
                        value={tgChatId}
                        onChange={(e) => setTgChatId(e.target.value)}
                        className="w-full bg-[#08090E] border border-[#1F2437] rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-[#1E40AF] transition-all font-mono"
                        placeholder="请输入您的私有频道或群组 Chat ID"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs text-gray-400 font-semibold uppercase">TELEGRAM API 网关</label>
                      <input 
                        type="text" 
                        value={tgApiUrl}
                        onChange={(e) => setTgApiUrl(e.target.value)}
                        className="w-full bg-[#08090E] border border-[#1F2437] rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-[#1E40AF] transition-all font-mono"
                        placeholder="默认为 https://api.telegram.org，走内网可填 http://telegram-bot-api:8081"
                      />
                    </div>
                  </div>
                )}

                {(activeDest === 'onedrive' || activeDest === 'gdrive') && (
                  <div className="space-y-4">
                    {/* 一键快捷 OAuth 授权组件 */}
                    <div className="bg-[#101524]/60 border border-[#1E40AF]/30 rounded-xl p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="text-left">
                          <span className="text-sm font-semibold text-white flex items-center gap-1.5">
                            <span className="text-yellow-500">⚡</span> 网页一键快捷 OAuth 授权
                          </span>
                          <span className="text-[11px] text-gray-400 block mt-0.5">
                            支持访问域名自动感知回调，无需手动折腾 rclone authorize 命令行
                          </span>
                        </div>
                        <button
                          onClick={handleFetchOAuthUrls}
                          disabled={oauthLoading}
                          className="bg-[#1E40AF] hover:bg-[#1E40AF]/80 disabled:bg-[#1F2437] text-white disabled:text-gray-500 px-4 py-2 rounded-lg text-xs font-semibold transition-all whitespace-nowrap"
                        >
                          {oauthLoading ? "正在载入..." : "开始快捷授权"}
                        </button>
                      </div>
                    </div>
                    <input 
                      type="file" 
                      ref={fileInputRef} 
                      onChange={handleFileChange} 
                      accept=".conf" 
                      style={{ display: 'none' }} 
                    />
                    <div 
                      onClick={() => fileInputRef.current?.click()}
                      onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
                      onDragLeave={() => setIsDragOver(false)}
                      onDrop={handleDrop}
                      className={`p-8 border-2 border-dashed rounded-xl text-center space-y-3 transition-all cursor-pointer ${isDragOver ? 'border-[#1E40AF] bg-[#1E40AF]/10' : 'border-[#1F2437] bg-[#08090E]/40 hover:border-[#1E40AF]'}`}
                    >
                      <Upload className="w-8 h-8 text-gray-500 mx-auto" />
                      <div>
                        <span className="text-sm font-semibold text-white block">拖拽或点击上传本地 rclone.conf</span>
                        <span className="text-xs text-gray-500 block mt-1">系统会自动提取 Token 参数并配置秒级热加载生效</span>
                      </div>
                    </div>
                    <div className="text-center text-xs text-gray-500">或者在下方直接粘贴配置文件内容：</div>
                    <textarea 
                      rows={5}
                      value={rcloneText}
                      onChange={(e) => setRcloneText(e.target.value)}
                      className="w-full bg-[#08090E] border border-[#1F2437] rounded-xl px-4 py-3 text-xs font-mono text-white focus:outline-none focus:border-[#1E40AF] transition-all"
                      placeholder="[my-onedrive]&#10;type = onedrive&#10;token = ..."
                    />
                    <button 
                      onClick={() => handleRcloneSubmit(rcloneText)}
                      className="w-full bg-[#1E40AF] hover:bg-[#1E40AF]/80 text-white px-5 py-3 rounded-xl transition-all text-sm font-semibold"
                    >
                      提交粘贴的 Rclone 凭证并重载
                    </button>
                  </div>
                )}

                {activeDest === 'pikpak' && (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <label className="text-xs text-gray-400 font-semibold uppercase">PikPak API 代理/辅助地址（官方 API 请保持为空）</label>
                      <input 
                        type="text" 
                        value={pikpakURL}
                        onChange={(e) => setPikpakURL(e.target.value)}
                        className="w-full bg-[#08090E] border border-[#1F2437] rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-[#1E40AF] transition-all font-mono"
                        placeholder="选填，若无 API 代理则保持为空"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs text-gray-400 font-semibold uppercase">登录用户名 (USERNAME)</label>
                      <input 
                        type="text" 
                        value={pikpakUser}
                        onChange={(e) => setPikpakUser(e.target.value)}
                        className="w-full bg-[#08090E] border border-[#1F2437] rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-[#1E40AF] transition-all font-mono"
                        placeholder="请输入登录用户名"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs text-gray-400 font-semibold uppercase">登录密码 (PASSWORD)</label>
                      <input 
                        type="password" 
                        value={pikpakPass}
                        onChange={(e) => setPikpakPass(e.target.value)}
                        className="w-full bg-[#08090E] border border-[#1F2437] rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-[#1E40AF] transition-all font-mono"
                        placeholder="请输入登录密码"
                      />
                    </div>
                  </div>
                )}

                <div className="pt-4 border-t border-[#1F2437]/60 space-y-3">
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => handleTestConnection(activeDest)}
                      disabled={testStatus[activeDest]?.status === 'testing'}
                      className={`px-4 py-2.5 rounded-xl text-xs font-semibold flex items-center gap-2 border transition-all ${
                        testStatus[activeDest]?.status === 'testing'
                          ? 'bg-[#1F2437] text-gray-500 border-gray-700 cursor-not-allowed'
                          : 'bg-transparent hover:bg-[#1E40AF]/10 text-white border-[#1E40AF]'
                      }`}
                    >
                      {testStatus[activeDest]?.status === 'testing' ? (
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <span>🔌</span>
                      )}
                      {testStatus[activeDest]?.status === 'testing' ? '正在连接测试...' : '测试当前存储池连接'}
                    </button>
                    
                    {testStatus[activeDest]?.status === 'ok' && (
                      <span className="text-xs text-[#10B981] font-semibold flex items-center gap-1">
                        <CheckCircle className="w-3.5 h-3.5" />
                        {testStatus[activeDest].msg}
                      </span>
                    )}
                    {testStatus[activeDest]?.status === 'error' && (
                      <span className="text-xs text-red-500 font-semibold flex items-center gap-1 font-mono leading-tight break-all">
                        ⚠️ {testStatus[activeDest].msg}
                      </span>
                    )}
                  </div>
                </div>

                {activeDest !== 'onedrive' && activeDest !== 'gdrive' && (
                  <div className="flex items-center gap-4 pt-4 border-t border-[#1F2437]">
                    <button 
                      onClick={handleSaveConfig}
                      className="flex-1 bg-[#1F2437] hover:bg-[#2A2F45] border border-[#2e3451] text-white px-5 py-3 rounded-xl transition-all text-sm font-semibold"
                    >
                      保存存储池参数
                    </button>
                  </div>
                )}

                {isSaved && (
                  <div className="flex items-center gap-2 text-[#10B981] text-sm bg-[#10B981]/10 p-3.5 rounded-xl border border-[#10B981]/20 animate-slideDown">
                    <CheckCircle className="w-5 h-5" />
                    参数配置已成功同步保存并生效！
                  </div>
                )}
              </div>
            </div>

            {/* Rclone 物理存储池管理终端：用于可视化管理和清理 VPS 宿主机 rclone.conf 中注册的远端，防止冗余配置 */}
            <div className="glass-panel p-6 border-l-4 border-blue-500/50 animate-slideDown space-y-4 bg-[#11131E]/20 border border-[#1F2437]/40">
              <div className="flex justify-between items-center">
                <div className="space-y-1">
                  <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                    <Database className="w-5 h-5 text-blue-400" />
                    Rclone 物理存储池管理终端
                  </h3>
                  <p className="text-xs text-gray-500">
                    管理 VPS 宿主机上 <code>rclone.conf</code> 中实际配置的物理存储池远端。支持物理卸载失效或冗余的加密外壳和基础云盘盘符，确保自动分发不发生重复上传。
                  </p>
                </div>
                <button
                  onClick={fetchRcloneRemotes}
                  className="text-xs text-gray-400 hover:text-white transition-colors border border-[#1F2437] px-2.5 py-1.5 rounded-lg bg-[#11131E]/50 flex items-center gap-1.5 font-mono"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  刷新物理远端列表
                </button>
              </div>

              {rcloneRemotes.length === 0 ? (
                <div className="text-sm text-gray-500 font-mono italic p-4 text-center border border-dashed border-[#1F2437] rounded-xl">
                  当前宿主机上无任何已保存的 Rclone 物理远端配置。
                </div>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-[#1F2437]/40">
                  <table className="w-full text-left text-xs border-collapse font-mono">
                    <thead>
                      <tr className="border-b border-[#1F2437] bg-[#11131E]/40 text-gray-400 font-semibold">
                        <th className="p-3">远端名称 (Remote Name)</th>
                        <th className="p-3">凭证类型 (Type)</th>
                        <th className="p-3">加密底层指向 (Remote Target)</th>
                        <th className="p-3 text-center">物理抹除操作</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#1F2437]/20 text-gray-300">
                      {rcloneRemotes.map((remote, idx) => (
                        <tr key={idx} className="hover:bg-white/5 transition-colors">
                          <td className="p-3 font-semibold text-white">{remote.name}</td>
                          <td className="p-3">
                            {(() => {
                              let label = remote.type ? remote.type.toUpperCase() : 'UNKNOWN';
                              let colorClass = 'bg-purple-500/10 text-purple-400 border border-purple-500/20';
                              
                              if (remote.type === 'crypt') {
                                colorClass = 'bg-blue-500/10 text-blue-400 border border-blue-500/20';
                                const dest = (remote.remote_dest || '').toLowerCase();
                                if (dest.includes('gdrive') || dest.includes('google')) {
                                  label = 'Google Drive (加密外壳)';
                                } else if (dest.includes('onedrive')) {
                                  label = 'OneDrive (加密外壳)';
                                } else if (dest.includes('pikpak')) {
                                  label = 'PikPak (加密外壳)';
                                } else if (dest.includes('drive')) {
                                  label = 'Google Drive (加密外壳)';
                                } else {
                                  label = 'Crypt (加密外壳)';
                                }
                              } else if (remote.type === 'drive') {
                                label = 'Google Drive (物理基础盘)';
                              } else if (remote.type === 'onedrive') {
                                label = 'OneDrive (物理基础盘)';
                              } else if (remote.type === 'pikpak') {
                                label = 'PikPak (物理基础盘)';
                              }
                              
                              return (
                                <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${colorClass}`}>
                                  {label}
                                </span>
                              );
                            })()}
                          </td>
                          <td className="p-3 text-gray-500">
                            {remote.remote_dest ? remote.remote_dest : <span className="italic text-gray-600">无 (物理基础盘)</span>}
                          </td>
                          <td className="p-3 text-center">
                            <button
                              onClick={() => handleDeleteRcloneRemote(remote.name)}
                              className="px-2.5 py-1 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 hover:border-red-500/40 rounded-lg text-xs font-semibold transition-all inline-flex items-center gap-1"
                            >
                              <Trash2 className="w-3 h-3" />
                              物理删除
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* 备份执行日志终端 */}
            {backupLog && (
              <div className={`glass-panel p-6 border-l-4 ${isError ? 'border-red-500/50' : 'border-[#8B5CF6]/50'} animate-slideDown space-y-3`}>
                <div className="flex justify-between items-center text-sm">
                  <span className="font-medium text-white flex items-center gap-2">
                    <FileCode className="w-4 h-4 text-[#1E40AF] animate-pulse" />
                    控制后台执行日志 & 沙箱健康报告
                  </span>
                  <button 
                    onClick={() => setBackupLog('')}
                    className="text-xs text-gray-500 hover:text-white transition-colors border border-[#1F2437] px-2.5 py-1 rounded-lg bg-[#11131E]/50 font-mono"
                  >
                    清除日志
                  </button>
                </div>
                <pre className="w-full bg-black/50 border border-[#1F2437]/40 rounded-xl p-4 text-xs font-mono text-gray-400 overflow-y-auto max-h-96 leading-relaxed whitespace-pre-wrap text-left">
                  {backupLog}
                </pre>
              </div>
            )}
          </div>
        )}


        {/* ==============================================================================
            D. 全局配置 Tab
            ============================================================================== */}
        {activeTab === 'settings' && (
          <div className="space-y-8 animate-fadeIn">
            <div>
              <h2 className="text-3xl font-bold text-white mb-2 font-mono">全局备份设置</h2>
              <p className="text-gray-500">设置备份加密密码、解耦分级的自动定时周期以及各存储池专属的 GFS 快照轮转淘汰规则。</p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
              <div className="lg:col-span-8 glass-panel p-6 space-y-6">
                
                {/* AES 加密及强校验 */}
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                    <Key className="w-5 h-5 text-[#8B5CF6]" />
                    本地 AES-256 对称加密主密码
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <span className="text-xs text-gray-500 block">备份加密主密码 (BACKUP_PASSWORD)</span>
                      <input 
                        type="password"
                        value={backupPass}
                        onChange={(e) => setBackupPass(e.target.value)}
                        className="w-full bg-[#08090E] border border-[#1F2437] rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-[#1E40AF] transition-all font-mono"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <span className="text-xs text-gray-500 block">密码正确性校验 (输入以验证记忆是否正确)</span>
                      <div className="flex gap-2">
                        <input 
                          type="password"
                          value={verifyPassInput}
                          onChange={(e) => setVerifyPassInput(e.target.value)}
                          placeholder="输入密码进行校验"
                          className="flex-1 bg-[#08090E] border border-[#1F2437] rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-[#1E40AF] transition-all font-mono"
                        />
                        <button 
                          onClick={handleVerifyPassword}
                          className="bg-[#1F2437] hover:bg-[#2A2F45] border border-[#2e3451] text-white px-4 py-2 rounded-xl text-xs font-semibold"
                        >
                          立即校验
                        </button>
                      </div>
                    </div>
                  </div>
                  {verifyResult === 'success' && (
                    <div className="text-[#10B981] bg-[#10B981]/10 border border-[#10B981]/20 p-2.5 rounded-lg text-xs font-semibold flex items-center gap-1.5">
                      <CheckCircle className="w-4 h-4" /> 校验通过！您输入的密码与系统正在使用的备份主密码一致。
                    </div>
                  )}
                  {verifyResult === 'fail' && (
                    <div className="text-red-500 bg-red-500/10 border border-red-500/20 p-2.5 rounded-lg text-xs font-semibold flex items-center gap-1.5">
                      <AlertTriangle className="w-4 h-4" /> 校验失败！您输入的密码不正确，请重新核对！
                    </div>
                  )}
                  <span className="text-xs text-[#F59E0B] bg-[#F59E0B]/10 border border-[#F59E0B]/20 p-3 rounded-xl block leading-relaxed font-mono">
                    ⚠️ <strong>警告</strong>：此密码作为 AES-256 算法的加密密钥盐。异地或冷备的所有文件都需要此密码方可解密。<strong>若遗失此密码，任何人都将无法解密您的备份数据！请务必写在离线纸质账本上。</strong>
                  </span>
                </div>

                {/* 任务历史与日志自动清理回收 */}
                <div className="border-t border-[#1F2437] pt-6 space-y-4">
                  <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                    <ListTodo className="w-5 h-5 text-blue-500" />
                    日志与历史任务清理回收设置
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <span className="text-xs text-gray-500 block">任务历史保留上限数量 (task_history_limit)</span>
                      <input 
                        type="number"
                        min="5"
                        max="1000"
                        value={taskHistoryLimit}
                        onChange={(e) => setTaskHistoryLimit(parseInt(e.target.value) || 50)}
                        className="w-full bg-[#08090E] border border-[#1F2437] rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-[#1E40AF] transition-all font-mono"
                      />
                      <span className="text-[10px] text-gray-400 block leading-tight">保留历史任务的最大数量，超出限制的旧任务将被自动修剪。</span>
                    </div>
                    <div className="space-y-1.5">
                      <span className="text-xs text-gray-500 block">日志与历史任务保存时间 (天)</span>
                      <input 
                        type="number"
                        min="1"
                        max="3650"
                        value={logKeepDays}
                        onChange={(e) => setLogKeepDays(parseInt(e.target.value) || 365)}
                        className="w-full bg-[#08090E] border border-[#1F2437] rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-[#1E40AF] transition-all font-mono"
                      />
                      <span className="text-[10px] text-gray-400 block leading-tight">超出此天数的系统日志和历史任务记录将被删除以回收空间（默认 365 天）。</span>
                    </div>
                  </div>
                </div>

                {/* 网络传输带宽限制规则 */}
                <div className="border-t border-[#1F2437] pt-6 space-y-4">
                  <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                    <Globe className="w-5 h-5 text-indigo-500" />
                    全局网络传输限速设置
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <span className="text-xs text-gray-500 block">网络同步上传/下载限速大小 (0 代表不限速)</span>
                      <div className="flex gap-2">
                        <input 
                          type="number"
                          min="0"
                          step="any"
                          value={bandwidthLimit || ''}
                          onChange={(e) => setBandwidthLimit(parseFloat(e.target.value) || 0)}
                          className="flex-1 bg-[#08090E] border border-[#1F2437] rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-[#1E40AF] transition-all font-mono"
                          placeholder="不限速"
                        />
                        <select
                          value={bandwidthUnit}
                          onChange={(e) => setBandwidthUnit(e.target.value as 'Mbps' | 'MB/s')}
                          className="bg-[#08090E] border border-[#1F2437] rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-[#1E40AF] transition-all cursor-pointer"
                        >
                          <option value="Mbps">Mbps</option>
                          <option value="MB/s">MB/s</option>
                        </select>
                      </div>
                      {bandwidthLimit > 0 && (
                        <span className="text-[10px] text-gray-400 block font-mono">
                          换算关系: {bandwidthLimit} {bandwidthUnit} = {
                            bandwidthUnit === 'Mbps' 
                              ? `${(bandwidthLimit / 8).toFixed(2)} MB/s (约 ${Math.round(bandwidthLimit * 125)} KB/s / Rclone 限速 \`--bwlimit ${(bandwidthLimit / 8).toFixed(2)}M\`)` 
                              : `${(bandwidthLimit * 8).toFixed(1)} Mbps (Rclone 限速 \`--bwlimit ${bandwidthLimit}M\`)`
                          }
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* 分级自动备份周期与多存储池 GFS */}
                <div className="border-t border-[#1F2437] pt-6 space-y-6">
                  <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                    <Settings className="w-5 h-5 text-[#1E40AF]" />
                    分级自动定时备份设置
                  </h3>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <label className="text-xs text-gray-400 font-semibold uppercase block">数据库热备执行周期 (db_hourly)</label>
                      <select 
                        value={cronHoursDB}
                        onChange={(e) => setCronHoursDB(e.target.value)}
                        className="w-full bg-[#08090E] border border-[#1F2437] rounded-xl px-4 py-3.5 text-sm text-white focus:outline-none focus:border-[#1E40AF] transition-all"
                      >
                        <option value="1">每 1 小时 (高频数据库热备份)</option>
                        <option value="2">每 2 小时</option>
                        <option value="6">每 6 小时</option>
                        <option value="12">每 12 小时</option>
                        <option value="24">每 24 小时 (每日备份)</option>
                      </select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs text-gray-400 font-semibold uppercase block">系统定期全量配置备份周期 (system_full)</label>
                      <select 
                        value={cronHoursSys}
                        onChange={(e) => setCronHoursSys(e.target.value)}
                        className="w-full bg-[#08090E] border border-[#1F2437] rounded-xl px-4 py-3.5 text-sm text-white focus:outline-none focus:border-[#1E40AF] transition-all"
                      >
                        <option value="12">每 12 小时</option>
                        <option value="24">每 24 小时 (推荐，每日全量备份)</option>
                        <option value="48">每 48 小时 (每两天)</option>
                        <option value="168">每 168 小时 (每周一次)</option>
                      </select>
                    </div>
                  </div>

                  {/* rclone Crypt 双重加密开关 */}
                  <div className="flex items-start justify-between gap-4 p-4 rounded-xl bg-[#11131E]/40 border border-[#1F2437]/40">
                    <div className="flex-1">
                      <span className="text-sm font-semibold text-white block">🔐 rclone Crypt 云端双重加密</span>
                      <p className="text-xs text-gray-400 mt-1 leading-relaxed">
                        启用后，备份文件上传至云端时额外经过 rclone Crypt 加密（文件名与内容双重加密）。
                        关闭时（默认），仅使用 AES-256 主密码加密，已足够安全，且上传更快、可直接下载使用。
                      </p>
                      <p className="text-[10px] text-yellow-500/80 mt-1">
                        ⚠️ 切换此选项后现有云端备份将无法通过新模式读取，建议切换前清空云端后重新备份。
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setUseRcloneCrypt(prev => !prev)}
                      className={`mt-1 flex-shrink-0 w-12 h-6 rounded-full transition-all duration-300 relative border border-[#2e3451] ${
                        useRcloneCrypt ? 'bg-[#1E40AF]' : 'bg-[#1F2437]'
                      }`}
                    >
                      <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all duration-300 ${
                        useRcloneCrypt ? 'left-6' : 'left-0.5'
                      }`} />
                    </button>
                  </div>
                </div>

                {/* 存储池专属 GFS 保留淘汰指令框 */}
                <div className="border-t border-[#1F2437] pt-6 space-y-6">
                  <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                    <Layers className="w-5 h-5 text-[#8B5CF6]" />
                    各个存储池专属 GFS 保留淘汰规则
                  </h3>
                  <p className="text-xs text-gray-500">规则书写格式形如：`H:24h; D:7d; W:30d; M:180d; Y:forever`。为空或填写 `forever` 代表永久保留。</p>
                  
                  {/* 1. 本地存储规则 */}
                  <div className="space-y-4 p-4 rounded-xl bg-[#11131E]/40 border border-[#1F2437]/40 space-y-3">
                    <span className="text-sm font-semibold text-white block">📁 服务器备份存储池保留规则 (Local Storage Pool)</span>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <span className="text-xs text-gray-500">数据库热备规则 (local_db_rule)</span>
                        <input type="text" value={localDBRule} onChange={(e) => setLocalDBRule(e.target.value)} className="w-full bg-[#08090E] border border-[#1F2437] rounded-lg px-3 py-2 text-xs font-mono text-white" />
                        <span className="text-[10px] text-gray-400 block leading-tight">{explainGFSRule(localDBRule)}</span>
                      </div>
                      <div className="space-y-1">
                        <span className="text-xs text-gray-500">系统备份规则 (local_sys_rule)</span>
                        <input type="text" value={localSysRule} onChange={(e) => setLocalSysRule(e.target.value)} className="w-full bg-[#08090E] border border-[#1F2437] rounded-lg px-3 py-2 text-xs font-mono text-white" />
                        <span className="text-[10px] text-gray-400 block leading-tight">{explainGFSRule(localSysRule)}</span>
                      </div>
                    </div>
                  </div>

                  {/* 2. OneDrive 规则 */}
                  <div className="space-y-4 p-4 rounded-xl bg-[#11131E]/40 border border-[#1F2437]/40 space-y-3">
                    <span className="text-sm font-semibold text-white block">☁️ OneDrive 异地存储池保留规则</span>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <span className="text-xs text-gray-500">数据库热备规则 (onedrive_db_rule)</span>
                        <input type="text" value={onedriveDBRule} onChange={(e) => setOneDriveDBRule(e.target.value)} className="w-full bg-[#08090E] border border-[#1F2437] rounded-lg px-3 py-2 text-xs font-mono text-white" />
                        <span className="text-[10px] text-gray-400 block leading-tight">{explainGFSRule(onedriveDBRule)}</span>
                      </div>
                      <div className="space-y-1">
                        <span className="text-xs text-gray-500">系统备份规则 (onedrive_sys_rule)</span>
                        <input type="text" value={onedriveSysRule} onChange={(e) => setOneDriveSysRule(e.target.value)} className="w-full bg-[#08090E] border border-[#1F2437] rounded-lg px-3 py-2 text-xs font-mono text-white" />
                        <span className="text-[10px] text-gray-400 block leading-tight">{explainGFSRule(onedriveSysRule)}</span>
                      </div>
                    </div>
                  </div>

                  {/* 3. GDrive 规则 */}
                  <div className="space-y-4 p-4 rounded-xl bg-[#11131E]/40 border border-[#1F2437]/40 space-y-3">
                    <span className="text-sm font-semibold text-white block">☁️ Google Drive 异地存储池保留规则</span>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <span className="text-xs text-gray-500">数据库热备规则 (gdrive_db_rule)</span>
                        <input type="text" value={gdriveDBRule} onChange={(e) => setGDriveDBRule(e.target.value)} className="w-full bg-[#08090E] border border-[#1F2437] rounded-lg px-3 py-2 text-xs font-mono text-white" />
                        <span className="text-[10px] text-gray-400 block leading-tight">{explainGFSRule(gdriveDBRule)}</span>
                      </div>
                      <div className="space-y-1">
                        <span className="text-xs text-gray-500">系统备份规则 (gdrive_sys_rule)</span>
                        <input type="text" value={gdriveSysRule} onChange={(e) => setGDriveSysRule(e.target.value)} className="w-full bg-[#08090E] border border-[#1F2437] rounded-lg px-3 py-2 text-xs font-mono text-white" />
                        <span className="text-[10px] text-gray-400 block leading-tight">{explainGFSRule(gdriveSysRule)}</span>
                      </div>
                    </div>
                  </div>

                  {/* 4. PikPak 规则 */}
                  <div className="space-y-4 p-4 rounded-xl bg-[#11131E]/40 border border-[#1F2437]/40 space-y-3">
                    <span className="text-sm font-semibold text-white block">☁️ PikPak (WebDAV) 存储池保留规则</span>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <span className="text-xs text-gray-500">数据库热备规则 (pikpak_db_rule)</span>
                        <input type="text" value={pikpakDBRule} onChange={(e) => setPikpakDBRule(e.target.value)} className="w-full bg-[#08090E] border border-[#1F2437] rounded-lg px-3 py-2 text-xs font-mono text-white" />
                        <span className="text-[10px] text-gray-400 block leading-tight">{explainGFSRule(pikpakDBRule)}</span>
                      </div>
                      <div className="space-y-1">
                        <span className="text-xs text-gray-500">系统备份规则 (pikpak_sys_rule)</span>
                        <input type="text" value={pikpakSysRule} onChange={(e) => setPikpakSysRule(e.target.value)} className="w-full bg-[#08090E] border border-[#1F2437] rounded-lg px-3 py-2 text-xs font-mono text-white" />
                        <span className="text-[10px] text-gray-400 block leading-tight">{explainGFSRule(pikpakSysRule)}</span>
                      </div>
                    </div>
                  </div>

                  {/* 5. Telegram 规则 */}
                  <div className="space-y-4 p-4 rounded-xl bg-[#11131E]/40 border border-[#1F2437]/40 space-y-3">
                    <span className="text-sm font-semibold text-white block">💬 Telegram Bot存档保留规则</span>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <span className="text-xs text-gray-500">数据库热备规则 (telegram_db_rule)</span>
                        <input type="text" value={telegramDBRule} onChange={(e) => setTelegramDBRule(e.target.value)} className="w-full bg-[#08090E] border border-[#1F2437] rounded-lg px-3 py-2 text-xs font-mono text-white" />
                        <span className="text-[10px] text-gray-400 block leading-tight">{explainGFSRule(telegramDBRule)}</span>
                      </div>
                      <div className="space-y-1">
                        <span className="text-xs text-gray-500">系统备份规则 (telegram_sys_rule)</span>
                        <input type="text" value={telegramSysRule} onChange={(e) => setTelegramSysRule(e.target.value)} className="w-full bg-[#08090E] border border-[#1F2437] rounded-lg px-3 py-2 text-xs font-mono text-white" />
                        <span className="text-[10px] text-gray-400 block leading-tight">{explainGFSRule(telegramSysRule)}</span>
                      </div>
                    </div>
                  </div>

                  {/* 6. 本地冷备客户端规则 */}
                  <div className="space-y-4 p-4 rounded-xl bg-[#11131E]/40 border border-[#1F2437]/40 space-y-3">
                    <span className="text-sm font-semibold text-white block">💻 本地冷备客户端保留规则 (Local Pull Client)</span>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <span className="text-xs text-gray-500">数据库冷备规则 (local_pull_db_rule)</span>
                        <input type="text" value={localPullDBRule} onChange={(e) => setLocalPullDBRule(e.target.value)} className="w-full bg-[#08090E] border border-[#1F2437] rounded-lg px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-[#1E40AF]" />
                        <span className="text-[10px] text-gray-400 block leading-tight">{explainGFSRule(localPullDBRule)}</span>
                      </div>
                      <div className="space-y-1">
                        <span className="text-xs text-gray-500">系统冷备规则 (local_pull_sys_rule)</span>
                        <input type="text" value={localPullSysRule} onChange={(e) => setLocalPullSysRule(e.target.value)} className="w-full bg-[#08090E] border border-[#1F2437] rounded-lg px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-[#1E40AF]" />
                        <span className="text-[10px] text-gray-400 block leading-tight">{explainGFSRule(localPullSysRule)}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 自选项目相对路径列表 */}
                <div className="border-t border-[#1F2437] pt-6 space-y-4">
                  <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                    <Database className="w-5 h-5 text-[#8B5CF6]" />
                    自选项目相对路径热备
                  </h3>
                  <div className="space-y-1.5">
                    <label className="text-xs text-gray-500 block">请输入要额外热备的文件或文件夹相对路径 (相对于 Stacks 目录，每行一个)：</label>
                    <textarea 
                      rows={4}
                      value={customPathsText}
                      onChange={(e) => setCustomPathsText(e.target.value)}
                      className="w-full bg-[#08090E] border border-[#1F2437] rounded-xl px-4 py-3 text-sm font-mono text-white focus:outline-none focus:border-[#1E40AF] transition-all"
                      placeholder="ldap/config/custom.conf&#10;vaultwarden/data/config.json"
                    />
                  </div>
                </div>

                {/* 配置导入与加密导出控制器 */}
                <div className="border-t border-[#1F2437] pt-6 space-y-4">
                  <span className="text-sm font-semibold text-white block">⚙️ 配置强加密导出与导入恢复</span>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="bg-[#11131E]/20 border border-[#1F2437]/50 rounded-xl p-4 flex flex-col justify-between">
                      <div>
                        <span className="text-xs text-white font-semibold">强加密导出配置</span>
                        <p className="text-[10px] text-gray-400 mt-1 leading-normal">
                          通过 AES-256 强加密将全局设置、Rclone配置及快照备注标签打包导出为 .enc 文件，安全可靠。
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={handleExportSettings}
                        className="mt-3 w-full bg-[#1F2437] hover:bg-[#2A2F45] text-white py-2 px-3 rounded-lg text-xs font-semibold transition-all border border-[#2e3451] flex items-center justify-center gap-1.5"
                      >
                        <Download className="w-3.5 h-3.5" />
                        安全导出加密配置文件
                      </button>
                    </div>

                    <div className="bg-[#11131E]/20 border border-[#1F2437]/50 rounded-xl p-4 flex flex-col justify-between">
                      <div>
                        <span className="text-xs text-white font-semibold">安全还原加密配置</span>
                        <p className="text-[10px] text-gray-400 mt-1 leading-normal">
                          上传加密导出的 .enc 文件，并输入强密码进行解密、按模块勾选合并导入。
                        </p>
                      </div>
                      <div className="mt-3 flex gap-2">
                        <input
                          type="file"
                          id="importSettingsFileInput"
                          accept=".enc"
                          onChange={handleImportFileChange}
                          style={{ display: 'none' }}
                        />
                        <button
                          type="button"
                          onClick={() => document.getElementById('importSettingsFileInput')?.click()}
                          className="flex-1 bg-[#1F2437] hover:bg-[#2A2F45] text-white py-2 px-3 rounded-lg text-xs font-semibold transition-all border border-[#2e3451] flex items-center justify-center gap-1.5"
                        >
                          <FileCode className="w-3.5 h-3.5" />
                          {importFile ? importFile.name : '选择配置包'}
                        </button>
                        <button
                          type="button"
                          onClick={handleDecryptAndParseSettings}
                          className="bg-[#1E40AF] hover:bg-[#1E40AF]/80 text-white py-2 px-4 rounded-lg text-xs font-semibold transition-all shadow-lg font-semibold"
                        >
                          解密校验
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* 导入预览及勾选框 */}
                  {importModules && (
                    <div className="bg-[#11131E]/50 border border-[#1F2437] rounded-xl p-4 space-y-4">
                      <div className="text-xs text-white font-semibold flex items-center justify-between border-b border-[#1F2437] pb-2">
                        <span>解密成功！请勾选需要还原的模块：</span>
                        <span className="text-[10px] text-gray-500">会话10分钟内有效</span>
                      </div>
                      <div className="space-y-2.5">
                        {Object.entries(importModules).map(([key, info]: [string, any]) => (
                          <div key={key} className="flex items-start gap-3 text-xs">
                            <input
                              type="checkbox"
                              id={`import_mod_${key}`}
                              disabled={!info.available || !info.compatible}
                              checked={selectedImportModules.includes(key)}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setSelectedImportModules(prev => [...prev, key]);
                                } else {
                                  setSelectedImportModules(prev => prev.filter(k => k !== key));
                                }
                              }}
                              className="mt-0.5 rounded border-[#1F2437] bg-[#08090E] text-[#1E40AF] focus:ring-0 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                            />
                            <div className="flex-1">
                              <label htmlFor={`import_mod_${key}`} className={`font-semibold select-none cursor-pointer flex items-center gap-2 ${(!info.available || !info.compatible) ? 'text-gray-600 cursor-not-allowed' : 'text-white'}`}>
                                {key === 'rclone' ? '☁️ 存储池配置凭证 (rclone.conf)' : 
                                  key === 'local_pull_manifest' ? '💻 本地冷备拉取清单' : 
                                  key === 'backup_password' ? '🔑 本地加密主密码' : 
                                  key === 'custom_paths' ? '📂 自选热备文件路径' : 
                                  key === 'gfs_backup_rules' ? '⏳ GFS 淘汰与周期规则' : 
                                  key === 'system_settings' ? '⚙️ 其他系统全局设置' : 
                                  key === 'task_history_logs' ? '📜 运行日志与历史任务' : 
                                  key === 'server_backup_list' ? '📁 服务器备份列表与标签(支持云端拉回自愈)' : key}
                                {info.has_missing_fields && (
                                  <span className="text-[10px] bg-red-500/10 text-red-500 border border-red-500/20 px-1 py-0.2 rounded font-normal">
                                    老版本配置兼容性警告
                                  </span>
                                )}
                              </label>
                              <p className="text-[10px] text-gray-400 mt-0.5 leading-normal">{info.message}</p>
                              {info.has_missing_fields && (
                                <p className="text-[10px] text-red-500 mt-1 leading-normal font-mono">
                                  ⚠️ 警告: 该配置备份缺少关键字段 (例如 telegram_api_url)，导入可能会导致当前系统运行故障，已安全置灰限制！
                                </p>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="flex justify-end gap-2 pt-2 border-t border-[#1F2437]/50">
                        <button
                          type="button"
                          onClick={() => {
                            setImportModules(null);
                            setImportFile(null);
                            setSelectedImportModules([]);
                          }}
                          className="bg-transparent hover:bg-[#1F2437] border border-[#1F2437] text-gray-400 px-4 py-2 rounded-lg text-xs font-semibold transition-all"
                        >
                          取消
                        </button>
                        <button
                          type="button"
                          onClick={handleConfirmImportSettings}
                          disabled={selectedImportModules.length === 0}
                          className="bg-green-500 hover:bg-green-600 text-white px-5 py-2 rounded-lg text-xs font-semibold transition-all shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          确认恢复选中配置
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                <div className="border-t border-[#1F2437] pt-6 flex justify-end">
                  <button 
                    onClick={handleSaveConfig}
                    className="bg-[#1E40AF] hover:bg-[#1E40AF]/80 text-white px-8 py-3.5 rounded-xl transition-all text-sm font-semibold shadow-lg shadow-[#1E40AF]/20"
                  >
                    确认保存全局配置
                  </button>
                </div>
              </div>

              {/* 离线灾备一键恢复工具下载 */}
              <div className="lg:col-span-4 glass-panel p-6 space-y-6 bg-[#11131E]/20">
                <div className="w-12 h-12 rounded-xl bg-[#8B5CF6]/10 border border-[#8B5CF6]/30 text-[#8B5CF6] flex items-center justify-center shadow-lg">
                  <FileCode className="w-6 h-6" />
                </div>
                <div className="space-y-2">
                  <h3 className="text-lg font-semibold text-white">离线恢复脚本直接下载</h3>
                  <p className="text-xs text-gray-400 leading-relaxed font-mono">
                    点击下方按钮直接下载最新的离线恢复脚本。在新机器上只需运行系统恢复脚本，脚本就会自动安装 Docker 并拉起所有的项目容器，实现全自动完全复原！
                  </p>
                </div>
                <div className="space-y-3 pt-2">
                  <a 
                    href={downloadToken ? `/api/backups/download?file=one_click_restore.sh&token=${downloadToken}` : '#!'}
                    download="one_click_restore.sh"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full bg-[#1E40AF]/10 hover:bg-[#1E40AF]/20 border border-[#1E40AF]/30 text-white px-4 py-3.5 rounded-xl transition-all text-xs font-semibold flex items-center justify-center gap-2"
                  >
                    <Download className="w-4 h-4 text-[#1E40AF]" />
                    下载终极恢复脚本 one_click_restore.sh
                  </a>
                </div>

                {/* 新机快速展开引导 */}
                <div className="border-t border-[#1F2437] pt-6 space-y-3">
                  <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                    🚀 新机快速展开引导
                  </h3>
                  <p className="text-xs text-gray-400 leading-relaxed">
                    复制下方整段脚本命令，在全新 VPS 上直接粘贴运行。将全自动安装 Docker 并使用您当前的配置初始化 Shield-Backup（无需依赖旧 VPS 运行状态）。
                  </p>
                  <textarea
                    readOnly
                    value={bootstrapCmd}
                    className="w-full h-32 bg-[#08090E] border border-[#1F2437] rounded-lg p-3 font-mono text-xs text-green-400 focus:outline-none resize-none overflow-y-auto"
                  />
                  <div className="flex gap-3">
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(bootstrapCmd);
                        showToast('一键部署指令已复制到剪贴板', 'success');
                      }}
                      className="text-xs bg-[#1E40AF]/10 hover:bg-[#1E40AF]/20 text-[#1E40AF] border border-[#1E40AF]/30 px-4 py-2 rounded-lg transition-all font-semibold"
                    >
                      📋 复制部署指令
                    </button>
                    <a
                      href={`/api/deploy/generate-bootstrap?token=${downloadToken}`}
                      download="shield_backup_bootstrap.sh"
                      className="text-xs bg-[#11131E]/60 hover:bg-[#1F2437]/60 text-gray-300 border border-[#1F2437] px-4 py-2 rounded-lg transition-all font-semibold"
                    >
                      💾 下载脚本文件
                    </a>
                  </div>
                  <div className="bg-[#11131E]/40 border border-[#1F2437]/40 rounded-lg p-3 space-y-1">
                    <p className="text-xs text-gray-400">运行成功后：</p>
                    <p className="text-xs text-gray-300">1. 打开 http://&lt;新VPS公网IP&gt;:9999</p>
                    <p className="text-xs text-gray-300">2. 设置页 → 导入 shield_backup_settings.enc</p>
                    <p className="text-xs text-gray-300">3. 等待云端自愈拉回 → 快照页一键恢复</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* ==============================================================================
          GFS 规则淘汰文件二次确认 Modal 弹窗
          ============================================================================== */}
      {showPreviewModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-[#11131E] border border-[#1F2437] rounded-2xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col shadow-2xl animate-scaleIn">
            <div className="p-6 border-b border-[#1F2437] flex items-center gap-3">
              <AlertTriangle className="w-6 h-6 text-[#F59E0B]" />
              <div>
                <h3 className="text-lg font-bold text-white leading-none">⚠️ 警告：检测到超出保留策略的快照</h3>
                <p className="text-xs text-gray-500 mt-1">您修改的 GFS 保留策略将会导致以下快照包超出保留时间范围而被彻底删除！</p>
              </div>
            </div>
            
            <div className="p-6 overflow-y-auto flex-1 space-y-4">
              <div className="overflow-x-auto border border-[#1F2437] rounded-xl bg-[#08090E]/60 max-h-72">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-[#1F2437] text-gray-500">
                      <th className="p-3 font-semibold uppercase">所属存储池</th>
                      <th className="p-3 font-semibold uppercase">待删除文件名</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1F2437]/40 font-mono text-gray-300">
                    {previewDeletes.map((item, idx) => (
                      <tr key={idx} className="hover:bg-[#11131E]/20">
                        <td className="p-3 font-semibold text-white">{item.pool}</td>
                        <td className="p-3 text-red-500 truncate max-w-xs" title={item.filename}>{item.filename}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              
              <p className="text-xs text-[#F59E0B] bg-[#F59E0B]/5 border border-[#F59E0B]/10 p-3.5 rounded-xl leading-relaxed">
                📢 **特别提醒**：一旦保存配置，这些被淘汰的文件将立即被各云端/本地存储池物理清除！该操作不可逆，请确认是否继续？
              </p>
            </div>

            <div className="p-6 border-t border-[#1F2437] bg-[#08090E]/30 flex justify-end gap-3 text-sm font-semibold">
              <button 
                onClick={() => setShowPreviewModal(false)}
                className="bg-transparent hover:bg-[#1F2437] border border-[#1F2437] text-gray-400 hover:text-white px-5 py-2.5 rounded-xl transition-all"
              >
                取消修改
              </button>
              <button 
                onClick={() => saveConfigDirectly(pendingConfig)}
                className="bg-red-500 hover:bg-red-600 text-white px-6 py-2.5 rounded-xl transition-all shadow-lg shadow-red-500/20"
              >
                确认保存并彻底删除超期快照
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==============================================================================
          Toast 浮动气泡提示弹窗
          ============================================================================== */}
      {toast && (
        <div className="fixed top-6 right-6 z-50 animate-slideIn">
          <div className={`backdrop-blur-md bg-[#11131E]/80 border ${
            toast.type === 'success' ? 'border-[#10B981]' :
            toast.type === 'error' ? 'border-red-500' :
            toast.type === 'warning' ? 'border-[#F59E0B]' : 'border-[#1E40AF]'
          } px-5 py-4 rounded-xl shadow-2xl flex items-center gap-3 text-sm text-white font-medium max-w-md`}>
            {toast.type === 'success' && <CheckCircle className="w-5 h-5 text-[#10B981] shrink-0" />}
            {toast.type === 'error' && <AlertTriangle className="w-5 h-5 text-red-500 shrink-0" />}
            {toast.type === 'warning' && <AlertTriangle className="w-5 h-5 text-[#F59E0B] shrink-0" />}
            {toast.type === 'info' && <Shield className="w-5 h-5 text-[#1E40AF] shrink-0" />}
            <span>{toast.message}</span>
          </div>
        </div>
      )}

      {/* ==============================================================================
          二次确认通用 Modal 弹窗
          ============================================================================== */}
      {confirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-[#11131E] border border-[#1F2437] rounded-2xl w-full max-w-md shadow-2xl animate-scaleIn overflow-hidden">
            <div className="p-6 border-b border-[#1F2437] flex items-center gap-3">
              <AlertTriangle className={`w-6 h-6 ${confirmModal.danger ? 'text-red-500' : 'text-[#1E40AF]'}`} />
              <h3 className="text-lg font-bold text-white leading-none">{confirmModal.title}</h3>
            </div>
            
            <div className="p-6 space-y-4">
              <p className="text-sm text-gray-400 leading-relaxed whitespace-pre-wrap text-left">{confirmModal.message}</p>
              
              {confirmModal.verifyText && (
                <div className="space-y-1.5 text-left">
                  <label className="text-xs text-gray-500 block font-semibold">
                    {confirmModal.verifyPlaceholder || `请输入 "${confirmModal.verifyText}" 以确认`}
                  </label>
                  <input
                    type="text"
                    value={confirmInput}
                    onChange={(e) => setConfirmInput(e.target.value)}
                    className="w-full bg-[#08090E] border border-[#1F2437] rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-[#1E40AF] transition-all font-mono"
                    placeholder={confirmModal.verifyPlaceholder || `输入 "${confirmModal.verifyText}"`}
                  />
                </div>
              )}
            </div>
            
            <div className="p-6 border-t border-[#1F2437] bg-[#08090E]/30 flex justify-end gap-3 text-sm font-semibold">
              <button 
                onClick={() => {
                  if (confirmModal.onCancel) confirmModal.onCancel();
                  setConfirmModal(null);
                  setConfirmInput('');
                }}
                className="bg-transparent hover:bg-[#1F2437] border border-[#1F2437] text-gray-400 hover:text-white px-4 py-2 rounded-xl transition-all"
              >
                取消
              </button>
              <button 
                onClick={() => {
                  if (!confirmModal.verifyText || confirmInput === confirmModal.verifyText) {
                    confirmModal.onConfirm();
                    setConfirmInput('');
                  }
                }}
                disabled={!!confirmModal.verifyText && confirmInput !== confirmModal.verifyText}
                className={`px-5 py-2 rounded-xl transition-all shadow-lg ${
                  (!!confirmModal.verifyText && confirmInput !== confirmModal.verifyText)
                    ? 'bg-gray-850 text-gray-650 border border-gray-700 cursor-not-allowed' 
                    : confirmModal.danger 
                      ? 'bg-red-500 hover:bg-red-600 text-white shadow-red-500/20' 
                      : 'bg-[#1E40AF] hover:bg-[#1E40AF]/80 text-white shadow-[#1E40AF]/20'
                }`}
              >
                确认
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==============================================================================
          高级配置备份安全导出 Modal 弹窗
          ============================================================================== */}
      {exportModal?.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-[#11131E] border border-[#1F2437] rounded-2xl w-full max-w-md shadow-2xl animate-scaleIn overflow-hidden">
            <div className="p-6 border-b border-[#1F2437] flex items-center gap-3">
              <Key className="w-6 h-6 text-[#8B5CF6]" />
              <h3 className="text-lg font-bold text-white leading-none">🔑 安全加密导出配置</h3>
            </div>
            
            <div className="p-6 space-y-4 text-left">
              <p className="text-xs text-gray-400 leading-normal">
                通过 AES-256 强加密算法将选中的配置类别打包导出为 `.enc` 加密文件。
              </p>
              
              <div className="space-y-2 bg-[#08090E]/40 border border-[#1F2437]/50 rounded-xl p-3 max-h-48 overflow-y-auto">
                <span className="text-[10px] text-gray-500 font-semibold block uppercase">选择导出类别：</span>
                {[
                  { key: 'rclone', label: '☁️ 存储池连接凭证 (rclone.conf)' },
                  { key: 'local_pull_manifest', label: '💻 本地冷备拉取清单' },
                  { key: 'backup_password', label: '🔑 本地加密主密码' },
                  { key: 'custom_paths', label: '📂 自选热备文件路径' },
                  { key: 'gfs_backup_rules', label: '⏳ GFS 淘汰与周期规则' },
                  { key: 'system_settings', label: '⚙️ 其他系统全局设置' },
                  { key: 'task_history_logs', label: '📜 运行日志与历史任务' },
                  { key: 'server_backup_list', label: '📁 服务器备份列表与标签(支持云端拉回自愈)' }
                ].map(item => (
                  <label key={item.key} className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer select-none">
                    <input 
                      type="checkbox"
                      checked={selectedExportCategories.includes(item.key)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedExportCategories(prev => [...prev, item.key]);
                        } else {
                          setSelectedExportCategories(prev => prev.filter(k => k !== item.key));
                        }
                      }}
                      className="rounded border-[#1F2437] bg-[#08090E] text-[#1E40AF] focus:ring-0 w-3.5 h-3.5"
                    />
                    {item.label}
                  </label>
                ))}
              </div>

              <div className="space-y-1.5">
                <label className="text-xs text-gray-400 block font-semibold">导出加密密码 (留空则默认使用项目主加密密钥)</label>
                <input
                  type="password"
                  value={exportPassword}
                  onChange={(e) => setExportPassword(e.target.value)}
                  className="w-full bg-[#08090E] border border-[#1F2437] rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-[#1E40AF] transition-all font-mono"
                  placeholder="请输入解密密码 (可选)"
                />
              </div>
            </div>
            
            <div className="p-6 border-t border-[#1F2437] bg-[#08090E]/30 flex justify-end gap-3 text-sm font-semibold">
              <button 
                onClick={() => {
                  setExportModal(null);
                  setExportPassword('');
                }}
                className="bg-transparent hover:bg-[#1F2437] border border-[#1F2437] text-gray-400 hover:text-white px-4 py-2 rounded-xl transition-all"
              >
                取消
              </button>
              <button 
                onClick={() => {
                  if (selectedExportCategories.length === 0) {
                    showToast("请至少勾选一个导出类别！", "warning");
                    return;
                  }
                  const pwdToUse = exportPassword;
                  const cats = selectedExportCategories.join(',');
                  window.location.href = `/api/settings/export?password=${encodeURIComponent(pwdToUse)}&categories=${encodeURIComponent(cats)}`;
                  setExportModal(null);
                  setExportPassword('');
                  showToast("加密配置文件导出成功！", "success");
                }}
                className="bg-[#1E40AF] hover:bg-[#1E40AF]/80 text-white px-5 py-2 rounded-xl transition-all shadow-lg shadow-[#1E40AF]/20"
              >
                安全导出
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==============================================================================
          编辑快照备注 EditLabelModal 弹窗
          ============================================================================== */}
      {editLabelModal?.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-[#11131E] border border-[#1F2437] rounded-2xl w-full max-w-md shadow-2xl animate-scaleIn overflow-hidden">
            <div className="p-6 border-b border-[#1F2437] flex items-center gap-3">
              <FileCode className="w-6 h-6 text-[#1E40AF]" />
              <h3 className="text-lg font-bold text-white leading-none">📌 编辑快照备注信息</h3>
            </div>
            
            <div className="p-6 space-y-4 text-left">
              <div className="space-y-1.5">
                <label className="text-[10px] text-gray-500 block font-mono truncate">快照: {editLabelModal.path}</label>
                <input
                  type="text"
                  value={editLabelInput}
                  onChange={(e) => setEditLabelInput(e.target.value)}
                  className="w-full bg-[#08090E] border border-[#1F2437] rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-[#1E40AF] transition-all"
                  placeholder="给此快照写个备注吧..."
                />
              </div>
            </div>
            
            <div className="p-6 border-t border-[#1F2437] bg-[#08090E]/30 flex justify-end gap-3 text-sm font-semibold">
              <button 
                onClick={() => {
                  setEditLabelModal(null);
                  setEditLabelInput('');
                }}
                className="bg-transparent hover:bg-[#1F2437] border border-[#1F2437] text-gray-400 hover:text-white px-4 py-2 rounded-xl transition-all"
              >
                取消
              </button>
              <button 
                onClick={() => {
                  handleSaveLabel(editLabelModal.path, editLabelInput);
                }}
                className="bg-[#1E40AF] hover:bg-[#1E40AF]/80 text-white px-5 py-2 rounded-xl transition-all shadow-lg shadow-[#1E40AF]/20"
              >
                保存备注
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==============================================================================
          网页快捷 OAuth 授权 OAuthModal 弹窗
          ============================================================================== */}
      {showOAuthModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-fadeIn">
          <div className="bg-[#11131E] border border-[#1F2437] rounded-2xl w-full max-w-lg shadow-2xl animate-scaleIn overflow-hidden">
            <div className="p-6 border-b border-[#1F2437] flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-xl">⚡</span>
                <h3 className="text-lg font-bold text-white leading-none">
                  连接 {activeDest === 'gdrive' ? 'Google Drive' : 'OneDrive'} OAuth 授权
                </h3>
              </div>
              <button 
                onClick={() => { setShowOAuthModal(false); setManualCode(''); }}
                className="text-gray-500 hover:text-white transition-all text-xl"
              >
                &times;
              </button>
            </div>
            
            <div className="p-6 space-y-6 text-left max-h-[70vh] overflow-y-auto">
              {/* 方式一：域名感知全自动授权 */}
              {oauthUrls.auto_url ? (
                <div className="space-y-2.5">
                  <span className="text-xs font-bold text-[#3B82F6] uppercase tracking-wider block">方式一：域名感知一键授权（最便捷）</span>
                  <p className="text-xs text-gray-400 leading-normal">
                    系统已自动感知您当前访问大厅所使用的域名 <b>{window.location.host}</b>。如果您已在谷歌云/微软开发者后台将此域名回调地址配置为 Authorized Redirect URI，可直接点击下方按钮：
                  </p>
                  <a 
                    href={oauthUrls.auto_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full bg-[#1E40AF] hover:bg-[#1E40AF]/80 text-white px-4 py-3 rounded-xl transition-all text-xs font-semibold text-center block"
                  >
                    跳转到网页进行自动授权
                  </a>
                  <span className="text-[10px] text-gray-500 block leading-tight text-center">
                    授权成功后，页面会自动提示，届时直接关闭该授权标签页并返回大厅刷新即可。
                  </span>
                </div>
              ) : (
                <div className="space-y-2.5">
                  <span className="text-xs font-bold text-gray-500 uppercase tracking-wider block">方式一：域名感知一键授权（未激活）</span>
                  <p className="text-xs text-gray-500 leading-normal">
                    检测到您当前使用局域网或裸 IP（如 {window.location.hostname}）直接访问。由于第三方授权服务通常要求备案域名或 https 证书，全自动回调在此环境下不可用。请直接使用下方的“手动粘贴”渠道进行授权。
                  </p>
                </div>
              )}

              <div className="border-t border-[#1F2437]/60 my-4"></div>

              {/* 方式二：手动环回地址栏粘贴授权 */}
              <div className="space-y-3">
                <span className="text-xs font-bold text-[#EAB308] uppercase tracking-wider block">方式二：万能手动授权粘贴（支持任何 IP / 局域网）</span>
                <p className="text-xs text-gray-400 leading-normal">
                  此方法具有 100% 兼容性。使用默认配置进行安全唤起：
                </p>
                <div className="space-y-3 bg-[#08090E]/60 p-4 border border-[#1F2437] rounded-xl">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-gray-400 font-medium">1. 点击链接进入授权同意页：</span>
                    <a 
                      href={oauthUrls.manual_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[#3B82F6] hover:underline font-semibold"
                    >
                      打开授权同意页面 &rarr;
                    </a>
                  </div>
                  <div className="space-y-1">
                    <span className="text-[11px] text-gray-400 leading-normal block">
                      2. 点击允许授权后，您的浏览器地址栏会跳转到一个打不开的 <b>http://127.0.0.1:53682/?code=xxx...</b> 页面。
                    </span>
                    <span className="text-[11px] text-red-400 font-semibold leading-normal block">
                      注意：浏览器会提示“无法访问此网站”，这属于正常现象。请不要关闭它，直接复制浏览器上方地址栏的完整网址链接！
                    </span>
                  </div>
                  <div className="space-y-1.5 pt-2">
                    <label className="text-[10px] text-gray-500 block font-semibold uppercase">3. 在下方粘贴您复制的完整网址（或 code 码）：</label>
                    <input
                      type="text"
                      value={manualCode}
                      onChange={(e) => setManualCode(e.target.value)}
                      className="w-full bg-[#08090E] border border-[#1F2437] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-[#1E40AF] transition-all font-mono"
                      placeholder="http://127.0.0.1:53682/?state=...&code=4/0Ad..."
                    />
                  </div>
                  <button 
                    onClick={handleSubmitOAuthCode}
                    disabled={oauthSubmitLoading}
                    className="w-full bg-[#1E40AF] hover:bg-[#1E40AF]/80 disabled:bg-[#1F2437] text-white disabled:text-gray-500 px-4 py-2 rounded-lg text-xs font-semibold transition-all"
                  >
                    {oauthSubmitLoading ? "正在解析并置换 Token..." : "提交链接完成授权"}
                  </button>
                </div>
              </div>
            </div>
            
            <div className="p-6 border-t border-[#1F2437] bg-[#08090E]/30 flex justify-end gap-3 text-sm font-semibold">
              <button 
                onClick={() => {
                  setShowOAuthModal(false);
                  setManualCode('');
                }}
                className="bg-transparent hover:bg-[#1F2437] border border-[#1F2437] text-gray-400 hover:text-white px-4 py-2 rounded-xl transition-all"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==============================================================================
          解密导入密码验证 DecryptImportModal 弹窗
          ============================================================================== */}
      {showDecryptModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-[#11131E] border border-[#1F2437] rounded-2xl w-full max-w-md shadow-2xl animate-scaleIn overflow-hidden">
            <div className="p-6 border-b border-[#1F2437] flex items-center gap-3">
              <Lock className="w-6 h-6 text-red-500" />
              <h3 className="text-lg font-bold text-white leading-none">🔑 输入解密验证密码</h3>
            </div>
            
            <div className="p-6 space-y-4 text-left">
              <p className="text-xs text-gray-400 leading-normal">
                检测到上传的配置包已强加密。请输入该配置包对应的解密主密码以验证导入资格：
              </p>
              <div className="space-y-1.5">
                <label className="text-xs text-gray-500 block font-semibold">解密主密码 (Decrypt Password)</label>
                <input
                  type="password"
                  value={decryptPassword}
                  onChange={(e) => setDecryptPassword(e.target.value)}
                  className="w-full bg-[#08090E] border border-[#1F2437] rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-[#1E40AF] transition-all font-mono"
                  placeholder="请输入该配置包解密密码"
                />
              </div>
            </div>
            
            <div className="p-6 border-t border-[#1F2437] bg-[#08090E]/30 flex justify-end gap-3 text-sm font-semibold">
              <button 
                onClick={() => {
                  setShowDecryptModal(false);
                  setDecryptPassword('');
                }}
                className="bg-transparent hover:bg-[#1F2437] border border-[#1F2437] text-gray-400 hover:text-white px-4 py-2 rounded-xl transition-all"
              >
                取消
              </button>
              <button 
                onClick={() => {
                  performDecrypt(decryptPassword);
                }}
                className="bg-[#1E40AF] hover:bg-[#1E40AF]/80 text-white px-5 py-2 rounded-xl transition-all shadow-lg shadow-[#1E40AF]/20"
              >
                验证并解密
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
