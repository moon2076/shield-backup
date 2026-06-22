package main

import (
	"archive/zip"
	"bufio"
	"bytes"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/md5"
	"crypto/rand"
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"log"
	"mime/multipart"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

//go:embed dist/*
var webResources embed.FS

// Config 对应 settings.json 的扩展结构
type Config struct {
	TelegramBotToken string   `json:"telegram_bot_token"`
	TelegramChatID   string   `json:"telegram_chat_id"`
	BackupPassword   string   `json:"backup_password"`
	CronHoursDB      string   `json:"cron_hours_db"`
	CronHoursSys     string   `json:"cron_hours_sys"`
	LocalDBRule      string   `json:"local_db_rule"`
	LocalSysRule     string   `json:"local_sys_rule"`
	TelegramDBRule   string   `json:"telegram_db_rule"`
	TelegramSysRule  string   `json:"telegram_sys_rule"`
	OneDriveDBRule   string   `json:"onedrive_db_rule"`
	OneDriveSysRule  string   `json:"onedrive_sys_rule"`
	GDriveDBRule     string   `json:"gdrive_db_rule"`
	GDriveSysRule    string   `json:"gdrive_sys_rule"`
	PikPakDBRule     string   `json:"pikpak_db_rule"`
	PikPakSysRule    string   `json:"pikpak_sys_rule"`
	LocalPullPath    string   `json:"local_pull_path"`
	PikPakURL        string   `json:"pikpak_url"`
	PikPakUser       string   `json:"pikpak_user"`
	PikPakPass       string   `json:"pikpak_pass"`
	CustomPaths      []string `json:"custom_paths"`       // 用户配置的自选热备相对路径
	SystemBackupMode string   `json:"system_backup_mode"` // "full_inc" (全量+累积增量), "full_only" (仅每日全量)
	DownloadToken    string   `json:"download_token"`     // 本地定时拉取助手安全 API Token
	TelegramApiURL   string   `json:"telegram_api_url"`   // 自定义 Telegram Bot API 网关
	LocalPullDBRule  string   `json:"local_pull_db_rule"`  // 本地冷备客户端数据库保留规则
	LocalPullSysRule string   `json:"local_pull_sys_rule"` // 本地冷备客户端系统保留规则
	TaskHistoryLimit int      `json:"task_history_limit"`  // 历史任务留存上限数量
}

type FileInfo struct {
	Name    string    `json:"Path"` // rclone lsjson 返回的键名为 Path
	Size    int64     `json:"Size"`
	ModTime time.Time `json:"ModTime"`
	IsDir   bool      `json:"IsDir"`
}

type FileState struct {
	Path  string `json:"path"`
	Size  int64  `json:"size"`
	Hash  string `json:"hash,omitempty"`
	MTime int64  `json:"mtime,omitempty"`
}

type GFSRule struct {
	Hourly  time.Duration
	Daily   time.Duration
	Weekly  time.Duration
	Monthly time.Duration
	Yearly  time.Duration
}

type HealthReport struct {
	BackupFile string    `json:"backup_file"`
	BackupType string    `json:"backup_type"` // "db" or "sys"
	Time       time.Time `json:"time"`
	DecryptOk  bool      `json:"decrypt_ok"`
	TarOk      bool      `json:"tar_ok"`
	DBCheckOk  bool      `json:"db_check_ok"`
	DBCheckMsg string    `json:"db_check_msg"`
	ComposeOk  bool      `json:"compose_ok"`
	ComposeMsg string    `json:"compose_msg"`
	Summary    string    `json:"summary"`
}

type TelegramRecord struct {
	Path      string    `json:"Path"`
	Size      int64     `json:"Size"`
	ModTime   time.Time `json:"ModTime"`
	MessageID int       `json:"MessageID"`
	FileID    string    `json:"FileID"`
}

var (
	configMutex   sync.Mutex
	configPath    = "/config/settings.json"
	currentConfig Config
	dbTicker      *time.Ticker
	dbTickerStop  chan struct{}
	sysTicker     *time.Ticker
	sysTickerStop chan struct{}

	// 新增：用于跟踪定时器及上次任务执行的运行状况（仅在内存中维护）
	dbNextTime            time.Time // 预计下次数据库备份时间
	dbLastStartTime       time.Time // 上次数据库备份开始时间
	dbLastEndTime         time.Time // 上次数据库备份结束时间
	dbLastStatus          string    // 上次数据库备份状态 ("success", "error", "skipped")
	dbLastLog             string    // 上次数据库备份日志输出/错误提示

	sysNextTime           time.Time // 预计下次系统备份时间
	sysLastStartTime      time.Time // 上次系统备份开始时间
	sysLastEndTime        time.Time // 上次系统备份结束时间
	sysLastStatus         string    // 上次系统备份状态 ("success", "error", "skipped")
	sysLastLog            string    // 上次系统备份日志输出/错误提示

	lastLocalPullSyncTime time.Time // 本地客户端最后同步拉取清单的时间
)

// LocalPullItem 表示本地冷备客户端虚拟逻辑清单的快照项
type LocalPullItem struct {
	Name    string    `json:"Path"`    // 兼容 FileInfo 接口的 Path 字段，实际为快照文件名
	Size    int64     `json:"Size"`    // 备份文件大小（字节数）
	ModTime time.Time `json:"ModTime"` // 修改/生成时间
	IsDir   bool      `json:"IsDir"`   // 是否为目录（固定为 false）
	Remark  string    `json:"Remark"`  // 手动备注标签信息
}

// TestConnectionRequest 存储池连接测试请求结构体
type TestConnectionRequest struct {
	Type             string `json:"type"`               // "telegram", "onedrive", "gdrive", "pikpak" 之一
	TelegramBotToken string `json:"telegram_bot_token"` // 可选
	TelegramApiURL   string `json:"telegram_api_url"`   // 可选
	PikPakURL        string `json:"pikpak_url"`          // 可选
	PikPakUser       string `json:"pikpak_user"`         // 可选
	PikPakPass       string `json:"pikpak_pass"`         // 可选
}

// LocalPullManifestRequest 客户端上报的文件列表请求结构体
type LocalPullManifestRequest struct {
	Files []struct {
		Name string `json:"name"` // 物理文件名
		Size int64  `json:"size"` // 文件大小
	} `json:"files"`
}

// LocalPullManifestResponse 服务端差异计算响应结构体
type LocalPullManifestResponse struct {
	Downloads []LocalPullItem `json:"downloads"` // 客户端需要拉取下载的差异包
	Deletes   []string        `json:"deletes"`   // 客户端应当清理的过期本地物理包
}

// TaskInfo 任务信息结构体
type TaskInfo struct {
	TaskID      string    `json:"task_id"`
	Name        string    `json:"name"`
	Type        string    `json:"type"`          // "db_backup", "sys_backup", "upload", "download", "sync"
	Status      string    `json:"status"`        // "pending", "running", "paused", "success", "error", "killed"
	Progress    int       `json:"progress"`
	Speed       string    `json:"speed"`
	StartTime   time.Time `json:"start_time"`
	EndTime     time.Time `json:"end_time"`
	ElapsedTime string    `json:"elapsed_time"`
	ETA         string    `json:"eta"`
	CurrentFile string    `json:"current_file"`
	ErrorMsg    string    `json:"error_msg"`
}

// 任务管理全局变量
var (
	activeTasksMutex sync.Mutex
	activeTasks      = make(map[string]*TaskInfo)
	taskCmds         = make(map[string]*exec.Cmd)
)

// 将任务保存至本地历史文件中
func saveTaskToHistory(task *TaskInfo) {
	activeTasksMutex.Lock()
	defer activeTasksMutex.Unlock()

	configMutex.Lock()
	limit := currentConfig.TaskHistoryLimit
	if limit <= 0 {
		limit = 50
	}
	configMutex.Unlock()

	historyPath := "/config/task_history.json"
	var history []TaskInfo
	if data, err := os.ReadFile(historyPath); err == nil {
		json.Unmarshal(data, &history)
	}

	found := false
	for i := range history {
		if history[i].TaskID == task.TaskID {
			history[i] = *task
			found = true
			break
		}
	}

	if !found {
		history = append([]TaskInfo{*task}, history...)
	}

	if len(history) > limit {
		history = history[:limit]
	}

	os.MkdirAll(filepath.Dir(historyPath), 0755)
	if data, err := json.MarshalIndent(history, "", "  "); err == nil {
		os.WriteFile(historyPath, data, 0644)
	}
}

// 获取全部的活跃与历史合并任务列表
func getMergedTaskList() []TaskInfo {
	activeTasksMutex.Lock()
	var list []TaskInfo
	for _, t := range activeTasks {
		list = append(list, *t)
	}
	activeTasksMutex.Unlock()

	historyPath := "/config/task_history.json"
	var history []TaskInfo
	if data, err := os.ReadFile(historyPath); err == nil {
		json.Unmarshal(data, &history)
	}

	seen := make(map[string]bool)
	var merged []TaskInfo
	for _, t := range list {
		merged = append(merged, t)
		seen[t.TaskID] = true
	}
	for _, t := range history {
		if !seen[t.TaskID] {
			merged = append(merged, t)
		}
	}

	sort.Slice(merged, func(i, j int) bool {
		return merged[i].StartTime.After(merged[j].StartTime)
	})

	return merged
}

// 统一包装带进度监控的执行器函数
func runTrackedCommand(taskType string, taskName string, cmdName string, args ...string) (string, error) {
	taskID := fmt.Sprintf("t_%d", time.Now().UnixNano())
	task := &TaskInfo{
		TaskID:    taskID,
		Name:      taskName,
		Type:      taskType,
		Status:    "running",
		StartTime: time.Now(),
		Progress:  0,
	}

	activeTasksMutex.Lock()
	activeTasks[taskID] = task
	activeTasksMutex.Unlock()

	saveTaskToHistory(task)

	// 如果是 rclone 运行，强制添加进度参数 -P 以解析指标
	isRclone := strings.Contains(cmdName, "rclone")
	if isRclone {
		hasP := false
		for _, arg := range args {
			if arg == "-P" || arg == "--progress" {
				hasP = true
				break
			}
		}
		if !hasP {
			args = append(args, "-P")
		}
	}

	cmd := exec.Command(cmdName, args...)

	if strings.Contains(cmdName, "backup.sh") {
		configMutex.Lock()
		customPathsJoined := strings.Join(currentConfig.CustomPaths, ";")
		cmd.Env = append(os.Environ(),
			"TELEGRAM_BOT_TOKEN="+currentConfig.TelegramBotToken,
			"TELEGRAM_CHAT_ID="+currentConfig.TelegramChatID,
			"BACKUP_PASSWORD="+currentConfig.BackupPassword,
			"CUSTOM_BACKUP_PATHS="+customPathsJoined,
		)
		configMutex.Unlock()
	}

	activeTasksMutex.Lock()
	taskCmds[taskID] = cmd
	activeTasksMutex.Unlock()

	stdoutPipe, err := cmd.StdoutPipe()
	if err != nil {
		activeTasksMutex.Lock()
		task.Status = "error"
		task.EndTime = time.Now()
		task.ErrorMsg = err.Error()
		activeTasksMutex.Unlock()
		saveTaskToHistory(task)
		return "", err
	}
	cmd.Stderr = cmd.Stdout

	if err := cmd.Start(); err != nil {
		activeTasksMutex.Lock()
		task.Status = "error"
		task.EndTime = time.Now()
		task.ErrorMsg = err.Error()
		activeTasksMutex.Unlock()
		saveTaskToHistory(task)
		return "", err
	}

	var outputBuf bytes.Buffer
	reader := io.TeeReader(stdoutPipe, &outputBuf)
	bufReader := bufio.NewReader(reader)

	stopUpdateDur := make(chan struct{})
	go func() {
		ticker := time.NewTicker(1 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				activeTasksMutex.Lock()
				if task.Status == "running" {
					dur := time.Since(task.StartTime)
					task.ElapsedTime = fmt.Sprintf("%02d:%02d", int(dur.Minutes()), int(dur.Seconds())%60)
				}
				activeTasksMutex.Unlock()
			case <-stopUpdateDur:
				return
			}
		}
	}()

	rePercent := regexp.MustCompile(`(\d+)%`)
	reSpeed := regexp.MustCompile(`([\d\.]+\s*[kMGT]?Bytes/s|[\d\.]+\s*[kMGT]B/s)`)
	reETA := regexp.MustCompile(`ETA\s+([^\s,]+)`)
	reFile := regexp.MustCompile(`\*\s+([^:]+):\s*\d+%`)

	for {
		line, err := bufReader.ReadString('\n')
		if err != nil {
			break
		}

		if isRclone {
			if m := rePercent.FindStringSubmatch(line); len(m) > 1 {
				pct, _ := strconv.Atoi(m[1])
				activeTasksMutex.Lock()
				if pct > task.Progress {
					task.Progress = pct
				}
				activeTasksMutex.Unlock()
			}
			if m := reSpeed.FindStringSubmatch(line); len(m) > 1 {
				activeTasksMutex.Lock()
				task.Speed = m[1]
				activeTasksMutex.Unlock()
			}
			if m := reETA.FindStringSubmatch(line); len(m) > 1 {
				activeTasksMutex.Lock()
				task.ETA = m[1]
				activeTasksMutex.Unlock()
			}
			if m := reFile.FindStringSubmatch(line); len(m) > 1 {
				activeTasksMutex.Lock()
				task.CurrentFile = filepath.Base(strings.TrimSpace(m[1]))
				activeTasksMutex.Unlock()
			}
		} else {
			activeTasksMutex.Lock()
			if strings.Contains(line, "导出 Vaultwarden SQLite") {
				task.Progress = 15
				task.CurrentFile = "Vaultwarden SQLite"
			} else if strings.Contains(line, "导出 LLDAP SQLite") {
				task.Progress = 30
				task.CurrentFile = "LLDAP SQLite"
			} else if strings.Contains(line, "导出自定义相对路径") {
				task.Progress = 45
				task.CurrentFile = "Custom Paths"
			} else if strings.Contains(line, "打包强加密") || strings.Contains(line, "tar") {
				task.Progress = 65
				task.CurrentFile = "AES CBC Encrypting"
			} else if strings.Contains(line, "灾备健康度验证") || strings.Contains(line, "openssl") {
				task.Progress = 80
				task.CurrentFile = "Sandbox Decrypt Verification"
			} else if strings.Contains(line, "rclone") || strings.Contains(line, "分发") {
				task.Progress = 90
				task.CurrentFile = "Distributing..."
			} else if strings.Contains(line, "[BACKUP_FILE_CREATED]") {
				task.Progress = 95
			}
			activeTasksMutex.Unlock()
		}
	}

	cmdErr := cmd.Wait()
	close(stopUpdateDur)

	activeTasksMutex.Lock()
	task.EndTime = time.Now()
	dur := task.EndTime.Sub(task.StartTime)
	task.ElapsedTime = fmt.Sprintf("%02d:%02d", int(dur.Minutes()), int(dur.Seconds())%60)

	if cmdErr != nil {
		if task.Status != "killed" {
			task.Status = "error"
			task.ErrorMsg = cmdErr.Error()
		}
	} else {
		task.Progress = 100
		task.Status = "success"
	}
	activeTasksMutex.Unlock()

	saveTaskToHistory(task)

	activeTasksMutex.Lock()
	delete(activeTasks, taskID)
	delete(taskCmds, taskID)
	activeTasksMutex.Unlock()

	return outputBuf.String(), cmdErr
}


// ------------------------------------------------------------------------------
// 1. 初始化与配置加载逻辑
// ------------------------------------------------------------------------------

func generateRandomToken() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "default_shield_token_12345"
	}
	return hex.EncodeToString(b)
}

func loadConfig() {
	configMutex.Lock()
	defer configMutex.Unlock()

	currentConfig = Config{
		TelegramBotToken: "your_telegram_bot_token_here",
		TelegramChatID:   "your_telegram_chat_id_here",
		BackupPassword:   "your_backup_passphrase_here",
		CronHoursDB:      "1",
		CronHoursSys:     "24",
		LocalDBRule:      "H:24h; D:7d; W:30d; M:180d; Y:forever",
		LocalSysRule:     "D:7d; W:30d; M:180d; Y:forever",
		TelegramDBRule:   "forever",
		TelegramSysRule:  "forever",
		OneDriveDBRule:   "H:24h; D:30d; W:90d; M:365d; Y:forever",
		OneDriveSysRule:  "D:30d; W:90d; M:365d; Y:forever",
		GDriveDBRule:     "H:24h; D:30d; W:90d; M:365d; Y:forever",
		GDriveSysRule:    "D:30d; W:90d; M:365d; Y:forever",
		PikPakDBRule:     "H:24h; D:30d; W:90d; M:365d; Y:forever",
		PikPakSysRule:    "D:30d; W:90d; M:365d; Y:forever",
		LocalPullPath:    `D:\Backup\VPS_Backup`,
		CustomPaths:      []string{},
		SystemBackupMode: "full_inc",
		DownloadToken:    generateRandomToken(),
		TelegramApiURL:   "https://api.telegram.org",
		LocalPullDBRule:  "H:24h; D:7d; W:30d; M:180d; Y:forever",
		LocalPullSysRule: "D:7d; W:30d; M:180d; Y:forever",
		TaskHistoryLimit: 50,
	}

	data, err := os.ReadFile(configPath)
	if err == nil {
		var loaded Config
		if err := json.Unmarshal(data, &loaded); err == nil {
			// 兼容旧版本 settings.json，平滑升级字段
			if loaded.CronHoursDB == "" {
				loaded.CronHoursDB = "1"
			}
			if loaded.CronHoursSys == "" {
				loaded.CronHoursSys = "24"
			}
			if loaded.LocalDBRule == "" {
				loaded.LocalDBRule = "H:24h; D:7d; W:30d; M:180d; Y:forever"
			}
			if loaded.LocalSysRule == "" {
				loaded.LocalSysRule = "D:7d; W:30d; M:180d; Y:forever"
			}
			if loaded.TelegramDBRule == "" {
				loaded.TelegramDBRule = "forever"
			}
			if loaded.TelegramSysRule == "" {
				loaded.TelegramSysRule = "forever"
			}
			if loaded.OneDriveDBRule == "" {
				loaded.OneDriveDBRule = "H:24h; D:30d; W:90d; M:365d; Y:forever"
			}
			if loaded.OneDriveSysRule == "" {
				loaded.OneDriveSysRule = "D:30d; W:90d; M:365d; Y:forever"
			}
			if loaded.GDriveDBRule == "" {
				loaded.GDriveDBRule = "H:24h; D:30d; W:90d; M:365d; Y:forever"
			}
			if loaded.GDriveSysRule == "" {
				loaded.GDriveSysRule = "D:30d; W:90d; M:365d; Y:forever"
			}
			if loaded.PikPakDBRule == "" {
				loaded.PikPakDBRule = "H:24h; D:30d; W:90d; M:365d; Y:forever"
			}
			if loaded.PikPakSysRule == "" {
				loaded.PikPakSysRule = "D:30d; W:90d; M:365d; Y:forever"
			}
			if loaded.LocalPullPath == "" {
				loaded.LocalPullPath = `D:\Backup\VPS_Backup`
			}
			if loaded.DownloadToken == "" {
				loaded.DownloadToken = generateRandomToken()
			}
			if loaded.CustomPaths == nil {
				loaded.CustomPaths = []string{}
			}
			if loaded.LocalPullDBRule == "" {
				loaded.LocalPullDBRule = "H:24h; D:7d; W:30d; M:180d; Y:forever"
			}
			if loaded.LocalPullSysRule == "" {
				loaded.LocalPullSysRule = "D:7d; W:30d; M:180d; Y:forever"
			}
			if loaded.TaskHistoryLimit <= 0 {
				loaded.TaskHistoryLimit = 50
			}
			currentConfig = loaded
			log.Printf("[INFO] 配置文件加载成功")
		} else {
			log.Printf("[WARN] 配置文件格式错误，使用默认设置")
		}
	} else {
		log.Printf("[INFO] 未找到配置文件，正在创建默认设置...")
		saveConfigNoLock(currentConfig)
	}
}

func saveConfigNoLock(cfg Config) error {
	os.MkdirAll(filepath.Dir(configPath), 0755)
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(configPath, data, 0644)
}

// ------------------------------------------------------------------------------
// 2. 定时同步调度双引擎
// ------------------------------------------------------------------------------

func restartScheduler() {
	configMutex.Lock()
	dbHoursStr := currentConfig.CronHoursDB
	sysHoursStr := currentConfig.CronHoursSys
	configMutex.Unlock()

	dbHours, err := strconv.Atoi(dbHoursStr)
	if err != nil || dbHours <= 0 {
		dbHours = 1
	}
	sysHours, err := strconv.Atoi(sysHoursStr)
	if err != nil || sysHours <= 0 {
		sysHours = 24
	}

	// 停止已有定时器
	if dbTicker != nil {
		dbTicker.Stop()
		close(dbTickerStop)
		dbTicker = nil
	}
	if sysTicker != nil {
		sysTicker.Stop()
		close(sysTickerStop)
		sysTicker = nil
	}

	dbTicker = time.NewTicker(time.Duration(dbHours) * time.Hour)
	dbTickerStop = make(chan struct{})
	sysTicker = time.NewTicker(time.Duration(sysHours) * time.Hour)
	sysTickerStop = make(chan struct{})

	// 记录下次预计运行时间
	dbNextTime = time.Now().Add(time.Duration(dbHours) * time.Hour)
	sysNextTime = time.Now().Add(time.Duration(sysHours) * time.Hour)

	// A. 数据库定时备份通道
	go func() {
		log.Printf("[SCHEDULER] 数据库热备定时器启动，周期: 每 %d 小时", dbHours)
		for {
			select {
			case <-dbTicker.C:
				dbNextTime = time.Now().Add(time.Duration(dbHours) * time.Hour)
				log.Printf("[SCHEDULER] 触发定时数据库热备份...")
				dbLastStartTime = time.Now()
				output, err := executeBackup("db", false)
				dbLastEndTime = time.Now()
				if err != nil {
					log.Printf("[ERROR] 定时数据库备份失败: %v, 输出: %s", err, output)
					dbLastStatus = "error"
					dbLastLog = err.Error()
				} else {
					log.Printf("[SUCCESS] 定时数据库备份完成，日志: %s", output)
					if strings.Contains(output, "[DEDUPLICATION]") {
						dbLastStatus = "skipped"
					} else {
						dbLastStatus = "success"
					}
					dbLastLog = output
					go runCleanupForPools("db")
				}
			case <-dbTickerStop:
				log.Printf("[SCHEDULER] 数据库定时器已停止")
				return
			}
		}
	}()

	// B. 系统定期备份通道
	go func() {
		log.Printf("[SCHEDULER] 系统备份定时器启动，周期: 每 %d 小时", sysHours)
		for {
			select {
			case <-sysTicker.C:
				sysNextTime = time.Now().Add(time.Duration(sysHours) * time.Hour)
				log.Printf("[SCHEDULER] 触发定时系统配置备份...")
				sysLastStartTime = time.Now()
				output, err := executeBackup("sys", false)
				sysLastEndTime = time.Now()
				if err != nil {
					log.Printf("[ERROR] 定时系统备份失败: %v, 输出: %s", err, output)
					sysLastStatus = "error"
					sysLastLog = err.Error()
				} else {
					log.Printf("[SUCCESS] 定时系统备份完成，日志: %s", output)
					if strings.Contains(output, "[DEDUPLICATION]") {
						sysLastStatus = "skipped"
					} else {
						sysLastStatus = "success"
					}
					sysLastLog = output
					go runCleanupForPools("sys")
				}
			case <-sysTickerStop:
				log.Printf("[SCHEDULER] 系统定时器已停止")
				return
			}
		}
	}()
}

// ------------------------------------------------------------------------------
// 3. 智能去重扫描校验
// ------------------------------------------------------------------------------

func getFileMD5(filePath string) (string, error) {
	file, err := os.Open(filePath)
	if err != nil {
		return "", err
	}
	defer file.Close()

	h := md5.New()
	if _, err := io.Copy(h, file); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

func isStatesEqual(s1, s2 []FileState) bool {
	if len(s1) != len(s2) {
		return false
	}
	sort.Slice(s1, func(i, j int) bool { return s1[i].Path < s1[j].Path })
	sort.Slice(s2, func(i, j int) bool { return s2[i].Path < s2[j].Path })

	for i := range s1 {
		if s1[i].Path != s2[i].Path || s1[i].Size != s2[i].Size || s1[i].Hash != s2[i].Hash || s1[i].MTime != s2[i].MTime {
			return false
		}
	}
	return true
}

func scanDBState() []FileState {
	var states []FileState

	// 1. Vaultwarden
	if info, err := os.Stat("/vaultwarden_data/db.sqlite3"); err == nil {
		h, _ := getFileMD5("/vaultwarden_data/db.sqlite3")
		states = append(states, FileState{
			Path: "vaultwarden/data/db.sqlite3",
			Size: info.Size(),
			Hash: h,
		})
	}

	// 2. LLDAP
	if info, err := os.Stat("/lldap_data/users.db"); err == nil {
		h, _ := getFileMD5("/lldap_data/users.db")
		states = append(states, FileState{
			Path: "ldap/data/users.db",
			Size: info.Size(),
			Hash: h,
		})
	}

	// 3. 自选相对路径文件
	configMutex.Lock()
	customPaths := currentConfig.CustomPaths
	configMutex.Unlock()

	for _, relPath := range customPaths {
		relPath = strings.TrimSpace(relPath)
		if relPath == "" {
			continue
		}
		relPath = strings.TrimPrefix(relPath, "/")
		hostPath := filepath.Join("/host/opt/stacks", relPath)

		filepath.Walk(hostPath, func(path string, info os.FileInfo, err error) error {
			if err != nil || info.IsDir() {
				return nil
			}
			h, _ := getFileMD5(path)
			rel, err := filepath.Rel("/host/opt/stacks", path)
			if err == nil {
				states = append(states, FileState{
					Path: filepath.ToSlash(rel),
					Size: info.Size(),
					Hash: h,
				})
			}
			return nil
		})
	}

	return states
}

func scanSysState() []FileState {
	var states []FileState

	configMutex.Lock()
	customPaths := make(map[string]bool)
	for _, p := range currentConfig.CustomPaths {
		p = strings.TrimSpace(p)
		if p != "" {
			customPaths[strings.TrimPrefix(p, "/")] = true
		}
	}
	configMutex.Unlock()

	filepath.Walk("/source_stacks", func(path string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() {
			return nil
		}

		rel, err := filepath.Rel("/source_stacks", path)
		if err != nil {
			return nil
		}
		rel = filepath.ToSlash(rel)

		// A. 排除任何 *.log 结尾的文件
		if strings.HasSuffix(strings.ToLower(info.Name()), ".log") {
			return nil
		}

		// B. 仅排除被独立热备份的核心数据库
		if rel == "vaultwarden/data/db.sqlite3" || rel == "ldap/data/users.db" {
			return nil
		}

		// C. 排除自选项目备份列表下的文件
		for cp := range customPaths {
			if rel == cp || strings.HasPrefix(rel, cp+"/") {
				return nil
			}
		}

		// D. 排除备份存储目录
		if rel == "backup-agent/config" || strings.HasPrefix(rel, "backup-agent/config/") {
			return nil
		}

		states = append(states, FileState{
			Path:  rel,
			Size:  info.Size(),
			MTime: info.ModTime().Unix(),
		})

		return nil
	})

	return states
}

func checkAndSaveDeduplication(backupType string) bool {
	statePath := ""
	var currentStates []FileState

	if backupType == "db" {
		statePath = "/config/last_db_backup_state.json"
		currentStates = scanDBState()
	} else if backupType == "sys" {
		monthStamp := time.Now().Format("200601")
		snarFile := fmt.Sprintf("/config/system_%s.snar", monthStamp)
		if time.Now().Day() == 1 || !fileExists(snarFile) {
			log.Printf("[DEDUPLICATION] 月度系统全量备份或 snar 文件不存在，跳过校对强制运行")
			return false
		}
		statePath = "/config/last_sys_backup_state.json"
		currentStates = scanSysState()
	} else {
		return false
	}

	var lastStates []FileState
	if data, err := os.ReadFile(statePath); err == nil {
		json.Unmarshal(data, &lastStates)
	}

	if isStatesEqual(currentStates, lastStates) {
		log.Printf("[DEDUPLICATION] %s 备份去重：检测到文件没有变更，跳过本次备份", backupType)
		return true
	}

	// 保存状态
	os.MkdirAll(filepath.Dir(statePath), 0755)
	if data, err := json.MarshalIndent(currentStates, "", "  "); err == nil {
		os.WriteFile(statePath, data, 0644)
	}
	return false
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return !os.IsNotExist(err)
}

// ------------------------------------------------------------------------------
// 4. 沙箱可用性校验与健康度报告
// ------------------------------------------------------------------------------

func checkSQLiteIntegrity(dbPath string) (bool, string) {
	if _, err := os.Stat(dbPath); os.IsNotExist(err) {
		return false, "数据库文件不存在"
	}
	cmd := exec.Command("sqlite3", dbPath, "PRAGMA integrity_check;")
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return false, fmt.Sprintf("运行故障: %v, %s", err, stderr.String())
	}
	outStr := strings.TrimSpace(stdout.String())
	if outStr == "ok" {
		return true, "健康"
	}
	return false, "一致性检验故障: " + outStr
}

func checkComposeSyntax(composePath string) (bool, string) {
	if _, err := os.Stat(composePath); os.IsNotExist(err) {
		return false, "Compose文件不存在"
	}
	cmd := exec.Command("docker-compose", "-f", composePath, "config", "-q")
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return false, fmt.Sprintf("语法解析故障: %s", strings.TrimSpace(stderr.String()))
	}
	return true, "语法正确"
}

func verifyBackupPackage(backupPath string, backupType string) HealthReport {
	report := HealthReport{
		BackupFile: filepath.Base(backupPath),
		BackupType: backupType,
		Time:       time.Now(),
	}

	sandboxDir := "/tmp/sandbox_verify"
	os.RemoveAll(sandboxDir)
	os.MkdirAll(sandboxDir, 0755)

	configMutex.Lock()
	pwd := currentConfig.BackupPassword
	configMutex.Unlock()

	// 1. 解密解包校验（加装3分钟超时保护，绝对防止卡死导致僵尸进程堆积）
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	cmdDec := exec.CommandContext(ctx, "openssl", "enc", "-d", "-aes-256-cbc", "-salt", "-pbkdf2", "-pass", "pass:"+pwd, "-in", backupPath)
	cmdTar := exec.CommandContext(ctx, "tar", "-xz", "-C", sandboxDir)

	// 创建操作系统级 Stdout 管道连接，直接喂给 tar 进程输入，不需要 Go 在内存中用 io.Pipe 同步中转
	stdoutPipe, err := cmdDec.StdoutPipe()
	if err != nil {
		report.DecryptOk = false
		report.TarOk = false
		report.Summary = fmt.Sprintf("无法创建解密管道: %v", err)
		saveHealthReport(report)
		return report
	}
	cmdTar.Stdin = stdoutPipe

	// 为两个进程设置独立的错误缓冲，避免并发竞争写入 non-thread-safe 的 bytes.Buffer
	var decStderr, tarStderr bytes.Buffer
	cmdDec.Stderr = &decStderr
	cmdTar.Stderr = &tarStderr

	if err := cmdDec.Start(); err != nil {
		report.DecryptOk = false
		report.TarOk = false
		report.Summary = fmt.Sprintf("启动解密进程 (openssl) 失败: %v", err)
		saveHealthReport(report)
		return report
	}

	if err := cmdTar.Start(); err != nil {
		stdoutPipe.Close()
		report.DecryptOk = false
		report.TarOk = false
		report.Summary = fmt.Sprintf("启动解压进程 (tar) 失败: %v", err)
		saveHealthReport(report)
		return report
	}
	stdoutPipe.Close()

	// 核心等待逻辑：必须先等待消费端 cmdTar 运行完毕，它会读完所有管道流
	errTar := cmdTar.Wait()
	errDec := cmdDec.Wait()

	if errDec != nil || errTar != nil {
		report.DecryptOk = (errDec == nil)
		report.TarOk = (errTar == nil)
		
		var errMsgs []string
		if errDec != nil {
			errMsgs = append(errMsgs, fmt.Sprintf("解密失败 (openssl): %v, 详情: %s", errDec, strings.TrimSpace(decStderr.String())))
		}
		if errTar != nil {
			errMsgs = append(errMsgs, fmt.Sprintf("解压失败 (tar): %v, 详情: %s", errTar, strings.TrimSpace(tarStderr.String())))
		}
		report.Summary = strings.Join(errMsgs, " | ")
		saveHealthReport(report)
		return report
	}

	report.DecryptOk = true
	report.TarOk = true

	// 2. 详细一致性校验
	if backupType == "db" {
		report.ComposeOk = true
		report.ComposeMsg = "不适用"

		vOk, vMsg := checkSQLiteIntegrity(filepath.Join(sandboxDir, "vaultwarden/data/db.sqlite3"))
		lOk, lMsg := checkSQLiteIntegrity(filepath.Join(sandboxDir, "ldap/data/users.db"))

		report.DBCheckOk = vOk && lOk
		report.DBCheckMsg = fmt.Sprintf("Vaultwarden: %s; LLDAP: %s", vMsg, lMsg)
	} else if backupType == "sys" {
		report.DBCheckOk = true
		report.DBCheckMsg = "不适用"

		var composeFiles []string
		filepath.Walk(sandboxDir, func(path string, info os.FileInfo, err error) error {
			if err == nil && !info.IsDir() {
				name := info.Name()
				if name == "compose.yaml" || name == "docker-compose.yml" {
					composeFiles = append(composeFiles, path)
				}
			}
			return nil
		})

		if len(composeFiles) == 0 {
			report.ComposeOk = true
			report.ComposeMsg = "未检测到 Compose 配置文件"
		} else {
			allOk := true
			var msgs []string
			for _, f := range composeFiles {
				rel, _ := filepath.Rel(sandboxDir, f)
				ok, msg := checkComposeSyntax(f)
				if !ok {
					allOk = false
					msgs = append(msgs, fmt.Sprintf("%s: %s", rel, msg))
				} else {
					msgs = append(msgs, fmt.Sprintf("%s: OK", rel))
				}
			}
			report.ComposeOk = allOk
			report.ComposeMsg = strings.Join(msgs, " | ")
		}
	}

	if report.DecryptOk && report.TarOk && report.DBCheckOk && report.ComposeOk {
		report.Summary = "灾备包可用性验证 100% 通过！"
	} else {
		report.Summary = "灾备包验证失败，存在损坏或配置语法错误风险！"
	}

	saveHealthReport(report)
	return report
}

func saveHealthReport(report HealthReport) {
	data, err := json.MarshalIndent(report, "", "  ")
	if err == nil {
		os.WriteFile("/config/health_report.json", data, 0644)
	}
}

// ------------------------------------------------------------------------------
// 5. Rclone 凭证自动解析与包装
// ------------------------------------------------------------------------------

func getActiveCloudRemotes() []string {
	var remotes []string
	if _, err := os.Stat("/config/rclone.conf"); os.IsNotExist(err) {
		return remotes
	}

	cmd := exec.Command("rclone", "listremotes", "--config", "/config/rclone.conf")
	var out bytes.Buffer
	cmd.Stdout = &out
	if err := cmd.Run(); err == nil {
		lines := strings.Split(out.String(), "\n")
		for _, line := range lines {
			line = strings.TrimSpace(line)
			if line != "" {
				remotes = append(remotes, line)
			}
		}
	}
	return remotes
}

func getRemoteType(remoteName string) string {
	remoteName = strings.TrimSuffix(remoteName, ":")
	data, err := os.ReadFile("/config/rclone.conf")
	if err != nil {
		return ""
	}

	content := string(data)
	sectionHeader := "[" + remoteName + "]"
	idx := strings.Index(content, sectionHeader)
	if idx == -1 {
		// 备用兜底逻辑
		lower := strings.ToLower(remoteName)
		if strings.Contains(lower, "onedrive") {
			return "onedrive"
		}
		if strings.Contains(lower, "gdrive") || strings.Contains(lower, "drive") {
			return "gdrive"
		}
		if strings.Contains(lower, "pikpak") {
			return "pikpak"
		}
		return ""
	}

	lines := strings.Split(content[idx:], "\n")
	remoteType := ""
	underlyingRemote := ""

	for i := 1; i < len(lines); i++ {
		line := strings.TrimSpace(lines[i])
		if strings.HasPrefix(line, "[") {
			break
		}
		if strings.HasPrefix(line, "type =") {
			remoteType = strings.TrimSpace(strings.Split(line, "=")[1])
		}
		if strings.HasPrefix(line, "remote =") {
			underlyingRemote = strings.TrimSpace(strings.Split(line, "=")[1])
			underlyingRemote = strings.Split(underlyingRemote, ":")[0]
		}
	}

	if remoteType == "crypt" && underlyingRemote != "" {
		return getRemoteType(underlyingRemote)
	}

	if remoteType == "onedrive" {
		return "onedrive"
	}
	if remoteType == "drive" {
		return "gdrive"
	}
	if remoteType == "webdav" || remoteType == "pikpak" {
		return "pikpak"
	}

	return remoteType
}

func autoWrapCloudRemotes(backupPassword string) {
	remotes := getActiveCloudRemotes()
	hasOneDrive := false
	hasOneDriveCrypt := false
	hasGDrive := false
	hasGDriveCrypt := false

	for _, r := range remotes {
		r = strings.TrimSuffix(r, ":")
		if r == "onedrive" || strings.Contains(strings.ToLower(r), "onedrive") {
			hasOneDrive = true
			if strings.HasSuffix(r, "-crypt") {
				hasOneDriveCrypt = true
			}
		}
		if r == "gdrive" || strings.Contains(strings.ToLower(r), "gdrive") {
			hasGDrive = true
			if strings.HasSuffix(r, "-crypt") {
				hasGDriveCrypt = true
			}
		}
	}

	// 如果有 onedrive 基础凭证但没套加密壳，自动为其包裹
	if hasOneDrive && !hasOneDriveCrypt {
		log.Printf("[RCLONE] 自动为 onedrive 创建 crypt 加密壳...")
		exec.Command("rclone", "config", "create", "onedrive-crypt", "crypt",
			"remote", "my-onedrive:backup/encrypted",
			"password", backupPassword,
			"--config", "/config/rclone.conf",
		).Run()
	}

	if hasGDrive && !hasGDriveCrypt {
		log.Printf("[RCLONE] 自动为 gdrive 创建 crypt 加密壳...")
		exec.Command("rclone", "config", "create", "gdrive-crypt", "crypt",
			"remote", "gdrive:backup/encrypted",
			"password", backupPassword,
			"--config", "/config/rclone.conf",
		).Run()
	}
}

// ------------------------------------------------------------------------------
// 6. GFS 淘汰决策机与脚本版本滚动
// ------------------------------------------------------------------------------

func parseDuration(s string) time.Duration {
	s = strings.TrimSpace(strings.ToLower(s))
	if s == "" || s == "never" || s == "0" {
		return 0
	}
	if s == "forever" || s == "always" || s == "-1" {
		return 100 * 365 * 24 * time.Hour
	}

	var numStr string
	var unit string
	for i, c := range s {
		if c >= '0' && c <= '9' {
			numStr += string(c)
		} else {
			unit = s[i:]
			break
		}
	}

	num, err := strconv.Atoi(numStr)
	if err != nil {
		return 0
	}

	switch unit {
	case "h", "hr", "hour", "hours":
		return time.Duration(num) * time.Hour
	case "d", "day", "days":
		return time.Duration(num) * 24 * time.Hour
	case "w", "wk", "week", "weeks":
		return time.Duration(num) * 7 * 24 * time.Hour
	case "m", "mon", "month", "months":
		return time.Duration(num) * 30 * 24 * time.Hour
	case "y", "yr", "year", "years":
		return time.Duration(num) * 365 * 24 * time.Hour
	default:
		return time.Duration(num) * time.Hour
	}
}

func parseGFSRule(ruleStr string) GFSRule {
	rule := GFSRule{}
	if strings.TrimSpace(ruleStr) == "" || strings.ToLower(strings.TrimSpace(ruleStr)) == "forever" {
		rule.Hourly = 100 * 365 * 24 * time.Hour
		rule.Daily = 100 * 365 * 24 * time.Hour
		rule.Weekly = 100 * 365 * 24 * time.Hour
		rule.Monthly = 100 * 365 * 24 * time.Hour
		rule.Yearly = 100 * 365 * 24 * time.Hour
		return rule
	}

	parts := strings.Split(ruleStr, ";")
	for _, part := range parts {
		kv := strings.Split(part, ":")
		if len(kv) != 2 {
			continue
		}
		key := strings.TrimSpace(strings.ToLower(kv[0]))
		val := strings.TrimSpace(kv[1])

		switch key {
		case "h", "hourly":
			rule.Hourly = parseDuration(val)
		case "d", "daily":
			rule.Daily = parseDuration(val)
		case "w", "weekly":
			rule.Weekly = parseDuration(val)
		case "m", "monthly":
			rule.Monthly = parseDuration(val)
		case "y", "yearly":
			rule.Yearly = parseDuration(val)
		}
	}
	return rule
}

func filterGFSFilesByRule(files []FileInfo, ruleStr string) []string {
	if len(files) == 0 {
		return nil
	}

	rule := parseGFSRule(ruleStr)

	var parsedFiles []struct {
		File FileInfo
		Time time.Time
	}
	for _, f := range files {
		// 特别保护，不能把恢复脚本或包含 _keep_ 的手动永久保留包作为过期备份清除
		if strings.HasPrefix(f.Name, "restore_system_") || strings.HasPrefix(f.Name, "restore_db_") || strings.Contains(f.Name, "_keep_") {
			continue
		}

		t, ok := parseTimeFromFilename(f.Name)
		if ok {
			parsedFiles = append(parsedFiles, struct {
				File FileInfo
				Time time.Time
			}{f, t})
		}
	}

	sort.Slice(parsedFiles, func(i, j int) bool {
		return parsedFiles[i].Time.Before(parsedFiles[j].Time)
	})

	now := time.Now()
	reserved := make(map[string]bool)

	dailyBuckets := make(map[string]string)
	weeklyBuckets := make(map[string]string)
	monthlyBuckets := make(map[string]string)
	yearlyBuckets := make(map[string]string)

	for _, pf := range parsedFiles {
		age := now.Sub(pf.Time)
		name := pf.File.Name

		if rule.Hourly > 0 && age <= rule.Hourly {
			reserved[name] = true
			continue
		}

		if rule.Daily > 0 && age <= rule.Daily {
			dayKey := pf.Time.Format("20060102")
			dailyBuckets[dayKey] = name
			continue
		}

		if rule.Weekly > 0 && age <= rule.Weekly {
			_, week := pf.Time.ISOWeek()
			weekKey := pf.Time.Format("2006") + "_w" + strconv.Itoa(week)
			weeklyBuckets[weekKey] = name
			continue
		}

		if rule.Monthly > 0 && age <= rule.Monthly {
			monthKey := pf.Time.Format("200601")
			monthlyBuckets[monthKey] = name
			continue
		}

		if rule.Yearly > 0 && age <= rule.Yearly {
			yearKey := pf.Time.Format("2006")
			yearlyBuckets[yearKey] = name
			continue
		}
	}

	for _, name := range dailyBuckets {
		reserved[name] = true
	}
	for _, name := range weeklyBuckets {
		reserved[name] = true
	}
	for _, name := range monthlyBuckets {
		reserved[name] = true
	}
	for _, name := range yearlyBuckets {
		reserved[name] = true
	}

	var toDelete []string
	for _, pf := range parsedFiles {
		if !reserved[pf.File.Name] {
			toDelete = append(toDelete, pf.File.Name)
		}
	}
	return toDelete
}

func filterScriptVersions(files []FileInfo) []string {
	var systemScripts []FileInfo
	var dbScripts []FileInfo

	for _, f := range files {
		if strings.HasPrefix(f.Name, "restore_system_") && strings.HasSuffix(f.Name, ".sh") {
			systemScripts = append(systemScripts, f)
		} else if strings.HasPrefix(f.Name, "restore_db_") && strings.HasSuffix(f.Name, ".sh") {
			dbScripts = append(dbScripts, f)
		}
	}

	var toDelete []string

	sort.Slice(systemScripts, func(i, j int) bool {
		return systemScripts[i].ModTime.After(systemScripts[j].ModTime)
	})
	sort.Slice(dbScripts, func(i, j int) bool {
		return dbScripts[i].ModTime.After(dbScripts[j].ModTime)
	})

	// 滚动保留 3 个版本恢复脚本
	if len(systemScripts) > 3 {
		for _, f := range systemScripts[3:] {
			toDelete = append(toDelete, f.Name)
		}
	}
	if len(dbScripts) > 3 {
		for _, f := range dbScripts[3:] {
			toDelete = append(toDelete, f.Name)
		}
	}

	return toDelete
}

func syncRestoreScriptsToPools() {
	sysMD5, _ := getFileMD5("/app/restore_system.sh")
	dbMD5, _ := getFileMD5("/app/restore_db.sh")

	if sysMD5 == "" || dbMD5 == "" {
		return
	}

	sysName := fmt.Sprintf("restore_system_%s.sh", sysMD5[:8])
	dbName := fmt.Sprintf("restore_db_%s.sh", dbMD5[:8])

	// 1. 本地冷备拷贝
	localDirs := []string{"/config/local_backup/hourly_db", "/config/local_backup/system_backup"}
	for _, dir := range localDirs {
		os.MkdirAll(dir, 0755)
		exec.Command("cp", "-f", "/app/restore_system.sh", filepath.Join(dir, sysName)).Run()
		exec.Command("cp", "-f", "/app/restore_db.sh", filepath.Join(dir, dbName)).Run()
	}

	// 2. 云端拷贝
	activeRemotes := getActiveCloudRemotes()
	for _, remote := range activeRemotes {
		exec.Command("rclone", "copyto", "/app/restore_system.sh", remote+"backup/hourly_db/"+sysName, "--config", "/config/rclone.conf").Run()
		exec.Command("rclone", "copyto", "/app/restore_db.sh", remote+"backup/hourly_db/"+dbName, "--config", "/config/rclone.conf").Run()

		exec.Command("rclone", "copyto", "/app/restore_system.sh", remote+"backup/system_backup/"+sysName, "--config", "/config/rclone.conf").Run()
		exec.Command("rclone", "copyto", "/app/restore_db.sh", remote+"backup/system_backup/"+dbName, "--config", "/config/rclone.conf").Run()
	}

	// 3. Telegram 频道发送
	sendTelegramScriptsIfNeeded(sysName, dbName)
}

func sendTelegramScriptsIfNeeded(sysName, dbName string) {
	statePath := "/config/telegram_scripts_state.json"
	type State struct {
		UploadedSys string `json:"uploaded_sys"`
		UploadedDB  string `json:"uploaded_db"`
	}

	var state State
	if data, err := os.ReadFile(statePath); err == nil {
		json.Unmarshal(data, &state)
	}

	configMutex.Lock()
	token := currentConfig.TelegramBotToken
	chatID := currentConfig.TelegramChatID
	apiURL := currentConfig.TelegramApiURL
	configMutex.Unlock()

	if token == "" || token == "your_telegram_bot_token_here" || chatID == "" {
		return
	}

	if apiURL == "" {
		apiURL = "https://api.telegram.org"
	}
	apiURL = strings.TrimSuffix(apiURL, "/")

	uploaded := false
	if state.UploadedSys != sysName {
		cmd := exec.Command("curl", "-s", "-F", "document=@/app/restore_system.sh",
			fmt.Sprintf("%s/bot%s/sendDocument", apiURL, token),
			"-F", "chat_id="+chatID,
			"-F", "caption=🔒 Shield-Backup 一键系统恢复脚本 ("+sysName+")\n#restore_script",
		)
		if cmd.Run() == nil {
			state.UploadedSys = sysName
			uploaded = true
		}
	}

	if state.UploadedDB != dbName {
		cmd := exec.Command("curl", "-s", "-F", "document=@/app/restore_db.sh",
			fmt.Sprintf("%s/bot%s/sendDocument", apiURL, token),
			"-F", "chat_id="+chatID,
			"-F", "caption=🔒 Shield-Backup 一键数据库恢复脚本 ("+dbName+")\n#restore_script",
		)
		if cmd.Run() == nil {
			state.UploadedDB = dbName
			uploaded = true
		}
	}

	if uploaded {
		if data, err := json.Marshal(state); err == nil {
			os.WriteFile(statePath, data, 0644)
		}
	}
}

func runCleanupForPools(backupType string) {
	log.Printf("[CLEANUP] 开始执行 %s 备份在各大储存池中的淘汰清理...", backupType)
	configMutex.Lock()
	cfg := currentConfig
	configMutex.Unlock()

	// 1. 本地存储清理
	if backupType == "db" || backupType == "all" {
		localDir := "/config/local_backup/hourly_db"
		if files, err := readLocalFiles(localDir); err == nil {
			toDelete := filterGFSFilesByRule(files, cfg.LocalDBRule)
			for _, filename := range toDelete {
				log.Printf("[CLEANUP] 清理本地超期数据库备份: %s", filename)
				os.Remove(filepath.Join(localDir, filename))
			}
			toDeleteScripts := filterScriptVersions(files)
			for _, filename := range toDeleteScripts {
				log.Printf("[CLEANUP] 清理本地超期恢复脚本: %s", filename)
				os.Remove(filepath.Join(localDir, filename))
			}
		}
	}
	if backupType == "sys" || backupType == "all" {
		localDir := "/config/local_backup/system_backup"
		if files, err := readLocalFiles(localDir); err == nil {
			toDelete := filterGFSFilesByRule(files, cfg.LocalSysRule)
			for _, filename := range toDelete {
				log.Printf("[CLEANUP] 清理本地超期系统配置备份: %s", filename)
				os.Remove(filepath.Join(localDir, filename))
			}
			toDeleteScripts := filterScriptVersions(files)
			for _, filename := range toDeleteScripts {
				log.Printf("[CLEANUP] 清理本地超期恢复脚本: %s", filename)
				os.Remove(filepath.Join(localDir, filename))
			}
		}
	}

	// 2. 云端存储清理 (OneDrive, Google Drive, PikPak)
	activeRemotes := getActiveCloudRemotes()
	for _, remote := range activeRemotes {
		remoteType := getRemoteType(remote)
		dbRule := ""
		sysRule := ""

		switch remoteType {
		case "onedrive":
			dbRule = cfg.OneDriveDBRule
			sysRule = cfg.OneDriveSysRule
		case "gdrive":
			dbRule = cfg.GDriveDBRule
			sysRule = cfg.GDriveSysRule
		case "pikpak":
			dbRule = cfg.PikPakDBRule
			sysRule = cfg.PikPakSysRule
		default:
			continue
		}

		if backupType == "db" || backupType == "all" {
			remoteDir := remote + "backup/hourly_db"
			if files, err := getRcloneFiles(remoteDir); err == nil {
				toDelete := filterGFSFilesByRule(files, dbRule)
				for _, filename := range toDelete {
					log.Printf("[CLEANUP] 清理云端 %s 超期数据库备份: %s", remote, filename)
					exec.Command("rclone", "deletefile", remoteDir+"/"+filename, "--config", "/config/rclone.conf").Run()
				}
				toDeleteScripts := filterScriptVersions(files)
				for _, filename := range toDeleteScripts {
					log.Printf("[CLEANUP] 清理云端 %s 超期恢复脚本: %s", remote, filename)
					exec.Command("rclone", "deletefile", remoteDir+"/"+filename, "--config", "/config/rclone.conf").Run()
				}
			}
		}

		if backupType == "sys" || backupType == "all" {
			remoteDir := remote + "backup/system_backup"
			if files, err := getRcloneFiles(remoteDir); err == nil {
				toDelete := filterGFSFilesByRule(files, sysRule)
				for _, filename := range toDelete {
					log.Printf("[CLEANUP] 清理云端 %s 超期系统配置备份: %s", remote, filename)
					exec.Command("rclone", "deletefile", remoteDir+"/"+filename, "--config", "/config/rclone.conf").Run()
				}
				toDeleteScripts := filterScriptVersions(files)
				for _, filename := range toDeleteScripts {
					log.Printf("[CLEANUP] 清理云端 %s 超期恢复脚本: %s", remote, filename)
					exec.Command("rclone", "deletefile", remoteDir+"/"+filename, "--config", "/config/rclone.conf").Run()
				}
			}
		}
	}

	// 3. Telegram 存储清理 (需要 deleteMessage API)
	if backupType == "db" || backupType == "all" {
		cleanupTelegramPool("db", cfg.TelegramDBRule)
	}
	if backupType == "sys" || backupType == "all" {
		cleanupTelegramPool("sys", cfg.TelegramSysRule)
	}
}

func cleanupTelegramPool(backupType string, ruleStr string) {
	historyPath := "/config/telegram_history.json"
	var records []TelegramRecord
	if data, err := os.ReadFile(historyPath); err == nil {
		json.Unmarshal(data, &records)
	}

	if len(records) == 0 {
		return
	}

	var typeRecords []TelegramRecord
	var otherRecords []TelegramRecord

	for _, r := range records {
		isHourly := strings.HasPrefix(r.Path, "db_hourly_")
		if (backupType == "db" && isHourly) || (backupType == "sys" && !isHourly) {
			typeRecords = append(typeRecords, r)
		} else {
			otherRecords = append(otherRecords, r)
		}
	}

	exemptionsPath := "/config/telegram_exemptions.json"
	var exemptions []string
	if data, err := os.ReadFile(exemptionsPath); err == nil {
		json.Unmarshal(data, &exemptions)
	}
	exMap := make(map[string]bool)
	for _, name := range exemptions {
		exMap[name] = true
	}

	var files []FileInfo
	for _, r := range typeRecords {
		fname := r.Path
		cleanName := strings.ReplaceAll(fname, "_keep_", "")
		if exMap[cleanName] {
			if strings.HasSuffix(cleanName, ".tar.gz.enc") {
				fname = strings.Replace(cleanName, ".tar.gz.enc", "_keep_.tar.gz.enc", 1)
			} else if strings.HasSuffix(cleanName, ".enc") {
				fname = strings.Replace(cleanName, ".enc", "_keep_.enc", 1)
			} else {
				fname = cleanName + "_keep_"
			}
		}
		files = append(files, FileInfo{
			Name:    fname,
			Size:    r.Size,
			ModTime: r.ModTime,
		})
	}

	toDelete := filterGFSFilesByRule(files, ruleStr)
	toDeleteMap := make(map[string]bool)
	for _, name := range toDelete {
		toDeleteMap[name] = true
	}

	configMutex.Lock()
	token := currentConfig.TelegramBotToken
	chatID := currentConfig.TelegramChatID
	apiURL := currentConfig.TelegramApiURL
	configMutex.Unlock()
	if apiURL == "" {
		apiURL = "https://api.telegram.org"
	}
	apiURL = strings.TrimSuffix(apiURL, "/")

	var kept []TelegramRecord
	for _, r := range typeRecords {
		rName := r.Path
		cleanName := strings.ReplaceAll(rName, "_keep_", "")
		if exMap[cleanName] {
			if strings.HasSuffix(cleanName, ".tar.gz.enc") {
				rName = strings.Replace(cleanName, ".tar.gz.enc", "_keep_.tar.gz.enc", 1)
			} else if strings.HasSuffix(cleanName, ".enc") {
				rName = strings.Replace(cleanName, ".enc", "_keep_.enc", 1)
			} else {
				rName = cleanName + "_keep_"
			}
		}

		if toDeleteMap[rName] {
			if token != "" && chatID != "" && r.MessageID > 0 {
				log.Printf("[CLEANUP] 正在从 Telegram 撤回超期备份消息: ID %d (文件 %s)", r.MessageID, r.Path)
				urlVal := fmt.Sprintf("%s/bot%s/deleteMessage?chat_id=%s&message_id=%d", apiURL, token, chatID, r.MessageID)
				exec.Command("curl", "-s", urlVal).Run()
			}
		} else {
			kept = append(kept, r)
		}
	}

	final := append(otherRecords, kept...)
	if data, err := json.MarshalIndent(final, "", "  "); err == nil {
		os.WriteFile(historyPath, data, 0644)
	}
}

func cleanupTelegramFile(filename string) {
	historyPath := "/config/telegram_history.json"
	var records []TelegramRecord
	if data, err := os.ReadFile(historyPath); err == nil {
		json.Unmarshal(data, &records)
	}

	configMutex.Lock()
	token := currentConfig.TelegramBotToken
	chatID := currentConfig.TelegramChatID
	apiURL := currentConfig.TelegramApiURL
	configMutex.Unlock()
	if apiURL == "" {
		apiURL = "https://api.telegram.org"
	}
	apiURL = strings.TrimSuffix(apiURL, "/")

	var kept []TelegramRecord
	for _, r := range records {
		rClean := strings.ReplaceAll(r.Path, "_keep_", "")
		fileClean := strings.ReplaceAll(filename, "_keep_", "")
		if rClean == fileClean {
			if token != "" && chatID != "" && r.MessageID > 0 {
				log.Printf("[CLEANUP] 手动从 Telegram 撤回消息: ID %d (文件 %s)", r.MessageID, r.Path)
				urlVal := fmt.Sprintf("%s/bot%s/deleteMessage?chat_id=%s&message_id=%d", apiURL, token, chatID, r.MessageID)
				exec.Command("curl", "-s", urlVal).Run()
			}
		} else {
			kept = append(kept, r)
		}
	}

	if data, err := json.MarshalIndent(kept, "", "  "); err == nil {
		os.WriteFile(historyPath, data, 0644)
	}

	// 同步在 exemptions.json 移除
	exemptionsPath := "/config/telegram_exemptions.json"
	var exemptions []string
	if data, err := os.ReadFile(exemptionsPath); err == nil {
		json.Unmarshal(data, &exemptions)
		var newEx []string
		fileClean := strings.ReplaceAll(filename, "_keep_", "")
		for _, name := range exemptions {
			if strings.ReplaceAll(name, "_keep_", "") != fileClean {
				newEx = append(newEx, name)
			}
		}
		if dataOut, err := json.MarshalIndent(newEx, "", "  "); err == nil {
			os.WriteFile(exemptionsPath, dataOut, 0644)
		}
	}
}

func parseTelegramLogAndSave(output string) {
	re := regexp.MustCompile(`\[TELEGRAM_MESSAGE_ID\]\s+([^:]+):(\d+)`)
	matches := re.FindAllStringSubmatch(output, -1)
	if len(matches) == 0 {
		return
	}

	historyPath := "/config/telegram_history.json"
	var records []TelegramRecord
	if data, err := os.ReadFile(historyPath); err == nil {
		json.Unmarshal(data, &records)
	}

	recordMap := make(map[string]*TelegramRecord)
	for i := range records {
		recordMap[records[i].Path] = &records[i]
	}

	updated := false
	for _, m := range matches {
		filename := m[1]
		msgID, _ := strconv.Atoi(m[2])

		var size int64
		var modTime time.Time
		localDirs := []string{"/config/local_backup/hourly_db", "/config/local_backup/system_backup"}
		found := false
		for _, dir := range localDirs {
			p := filepath.Join(dir, filename)
			if info, err := os.Stat(p); err == nil {
				size = info.Size()
				modTime = info.ModTime()
				found = true
				break
			}
		}

		if !found {
			size = 0
			modTime = time.Now()
		}

		if r, ok := recordMap[filename]; ok {
			r.MessageID = msgID
			r.Size = size
			r.ModTime = modTime
		} else {
			newRecord := TelegramRecord{
				Path:      filename,
				Size:      size,
				ModTime:   modTime,
				MessageID: msgID,
			}
			records = append(records, newRecord)
			recordMap[filename] = &records[len(records)-1]
		}
		updated = true
	}

	if updated {
		if data, err := json.MarshalIndent(records, "", "  "); err == nil {
			os.WriteFile(historyPath, data, 0644)
		}
	}
}

func sendTelegramMessage(text string) {
	configMutex.Lock()
	token := currentConfig.TelegramBotToken
	chatID := currentConfig.TelegramChatID
	apiURL := currentConfig.TelegramApiURL
	configMutex.Unlock()

	if token == "" || token == "your_telegram_bot_token_here" || chatID == "" {
		return
	}
	if apiURL == "" {
		apiURL = "https://api.telegram.org"
	}
	apiURL = strings.TrimSuffix(apiURL, "/")

	msg := "🔒 *Shield-Backup 灾备校验通知*\n\n" + text
	urlVal := fmt.Sprintf("%s/bot%s/sendMessage?chat_id=%s&text=%s&parse_mode=Markdown", apiURL, token, chatID, url.QueryEscape(msg))
	exec.Command("curl", "-s", urlVal).Run()
}

// ------------------------------------------------------------------------------
// 7. 核心备份与验证控制器
// ------------------------------------------------------------------------------

func executeBackup(backupType string, isManual bool) (string, error) {
    return "", nil
}

// ------------------------------------------------------------------------------
// 辅助函数与大文件直传实现
// ------------------------------------------------------------------------------

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()

	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()

	_, err = io.Copy(out, in)
	if err != nil {
		return err
	}
	return out.Sync()
}

func getFileSizeString(path string) string {
	fi, err := os.Stat(path)
	if err != nil {
		return "未知"
	}
	size := fi.Size()
	const unit = 1024
	if size < unit {
		return fmt.Sprintf("%d B", size)
	}
	div, exp := int64(unit), 0
	for n := size / unit; n >= unit; n /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.2f %cB", float64(size)/float64(div), "KMGTPE"[exp])
}

func fileInfoSize(path string) int64 {
	fi, err := os.Stat(path)
	if err != nil {
		return 0
	}
	return fi.Size()
}

func saveTelegramRecordDirectly(filename string, msgID int, fileID string, size int64) {
	historyPath := "/config/telegram_history.json"
	var records []TelegramRecord
	if data, err := os.ReadFile(historyPath); err == nil {
		json.Unmarshal(data, &records)
	}

	found := false
	for i := range records {
		if records[i].Path == filename {
			records[i].MessageID = msgID
			records[i].FileID = fileID
			records[i].Size = size
			records[i].ModTime = time.Now()
			found = true
			break
		}
	}

	if !found {
		newRecord := TelegramRecord{
			Path:      filename,
			Size:      size,
			ModTime:   time.Now(),
			MessageID: msgID,
			FileID:    fileID,
		}
		records = append(records, newRecord)
	}

	if data, err := json.MarshalIndent(records, "", "  "); err == nil {
		os.WriteFile(historyPath, data, 0644)
	}
}

func uploadFileToTelegram(filePath string, caption string) (int, string, error) {
	configMutex.Lock()
	token := currentConfig.TelegramBotToken
	chatID := currentConfig.TelegramChatID
	apiURL := currentConfig.TelegramApiURL
	configMutex.Unlock()

	if token == "" || token == "your_telegram_bot_token_here" || chatID == "" {
		return 0, "", fmt.Errorf("Telegram Bot 配置未完成")
	}

	file, err := os.Open(filePath)
	if err != nil {
		return 0, "", fmt.Errorf("无法打开文件: %v", err)
	}
	defer file.Close()

	if apiURL == "" {
		apiURL = "https://api.telegram.org"
	}
	apiURL = strings.TrimSuffix(apiURL, "/")
	reqURL := fmt.Sprintf("%s/bot%s/sendDocument", apiURL, token)

	pr, pw := io.Pipe()
	writer := multipart.NewWriter(pw)

	go func() {
		defer pw.Close()
		defer writer.Close()

		err := writer.WriteField("chat_id", chatID)
		if err != nil {
			return
		}

		err = writer.WriteField("caption", caption)
		if err != nil {
			return
		}

		part, err := writer.CreateFormFile("document", filepath.Base(filePath))
		if err != nil {
			return
		}

		_, err = io.Copy(part, file)
		if err != nil {
			return
		}
	}()

	req, err := http.NewRequest("POST", reqURL, pr)
	if err != nil {
		return 0, "", fmt.Errorf("构造请求失败: %v", err)
	}

	req.Header.Set("Content-Type", writer.FormDataContentType())

	// 设置一个较长的超时时间（30分钟），确保大包直传稳定性
	client := &http.Client{
		Timeout: 30 * time.Minute,
	}

	resp, err := client.Do(req)
	if err != nil {
		return 0, "", fmt.Errorf("发送请求失败: %v", err)
	}
	defer resp.Body.Close()

	bodyBytes, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return 0, "", fmt.Errorf("Telegram 响应失败 (状态码 %d): %s", resp.StatusCode, string(bodyBytes))
	}

	var tgResp struct {
		Ok     bool `json:"ok"`
		Result struct {
			MessageID int `json:"message_id"`
			Document  struct {
				FileID string `json:"file_id"`
			} `json:"document"`
		} `json:"result"`
	}

	if err := json.Unmarshal(bodyBytes, &tgResp); err != nil {
		return 0, "", fmt.Errorf("解析 Telegram 响应失败: %v", err)
	}

	if !tgResp.Ok {
		return 0, "", fmt.Errorf("Telegram 返回失败状态")
	}

	return tgResp.Result.MessageID, tgResp.Result.Document.FileID, nil
}

func syncBackupFileToClouds(filePath string, backupType string) {
	if _, err := os.Stat("/config/rclone.conf"); os.IsNotExist(err) {
		log.Printf("[RCLONE] rclone.conf 不存在，跳过云端同步")
		return
	}

	activeRemotes := getActiveCloudRemotes()
	if len(activeRemotes) == 0 {
		log.Printf("[RCLONE] 未配置任何活动的云端储存池，跳过同步")
		return
	}

	fileName := filepath.Base(filePath)
	var subDir string
	if backupType == "db" {
		subDir = "backup/hourly_db/"
	} else {
		subDir = "backup/system_backup/"
	}

	for _, remote := range activeRemotes {
		destPath := remote + subDir + fileName
		log.Printf("[RCLONE] 正在将备份同步至云端: %s ...", destPath)

		// 增加重试和高容错参数，限速单线程以维持 PikPak/OneDrive 的传输稳定性
		args := []string{
			"copyto", filePath, destPath,
			"--config", "/config/rclone.conf",
			"--transfers", "1",
			"--retries", "5",
			"--retries-sleep", "10s",
			"--low-level-retries", "10",
		}

		remoteClean := strings.TrimSuffix(remote, ":")
		if output, err := runTrackedCommand("upload", "云端备份同步 ("+remoteClean+")", "rclone", args...); err != nil {
			log.Printf("[ERROR] 同步至云盘 %s 失败: %v, 错误详情: %s", remote, err, output)
		} else {
			log.Printf("[OK] 云端 %s 同步成功", remote)
		}
	}
}

func getLatestFile(dir string) string {
	files, err := readLocalFiles(dir)
	if err != nil || len(files) == 0 {
		return ""
	}
	sort.Slice(files, func(i, j int) bool {
		return files[i].ModTime.After(files[j].ModTime)
	})
	return filepath.Join(dir, files[0].Name)
}

func parseTimeFromFilename(filename string) (time.Time, bool) {
	re := regexp.MustCompile(`\d{8}_\d{6}`)
	match := re.FindString(filename)
	if match == "" {
		reFull := regexp.MustCompile(`system_full_(\d{6})`)
		matchFull := reFull.FindStringSubmatch(filename)
		if len(matchFull) > 1 {
			t, err := time.ParseInLocation("200601", matchFull[1], time.Local)
			if err == nil {
				return t, true
			}
		}
		return time.Time{}, false
	}
	t, err := time.ParseInLocation("20060102_150405", match, time.Local)
	if err == nil {
		return t, true
	}
	return time.Time{}, false
}

// ------------------------------------------------------------------------------
// 8. 本地文件操作
// ------------------------------------------------------------------------------

func readLocalFiles(dir string) ([]FileInfo, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return []FileInfo{}, nil
		}
		return nil, err
	}

	var files []FileInfo
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		info, err := entry.Info()
		if err == nil {
			// 过滤掉恢复脚本，不在正常备份表格中出现，防止混乱
			name := entry.Name()
			if strings.HasPrefix(name, "restore_system_") || strings.HasPrefix(name, "restore_db_") {
				continue
			}
			files = append(files, FileInfo{
				Name:    name,
				Size:    info.Size(),
				ModTime: info.ModTime(),
				IsDir:   false,
			})
		}
	}
	return files, nil
}

func getRcloneFiles(remotePath string) ([]FileInfo, error) {
	var stdout, stderr bytes.Buffer
	cmd := exec.Command("rclone", "lsjson", remotePath, "--config", "/config/rclone.conf")
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		return nil, err
	}

	var files []FileInfo
	if err := json.Unmarshal(stdout.Bytes(), &files); err != nil {
		return nil, err
	}

	// 同样过滤掉云端的恢复脚本
	var filtered []FileInfo
	for _, f := range files {
		if strings.HasPrefix(f.Name, "restore_system_") || strings.HasPrefix(f.Name, "restore_db_") {
			continue
		}
		filtered = append(filtered, f)
	}

	return filtered, nil
}

func hasRcloneRemote() bool {
	if _, err := os.Stat("/config/rclone.conf"); os.IsNotExist(err) {
		return false
	}
	var out bytes.Buffer
	cmd := exec.Command("rclone", "listremotes", "--config", "/config/rclone.conf")
	cmd.Stdout = &out
	if err := cmd.Run(); err != nil {
		return false
	}
	return len(strings.TrimSpace(out.String())) > 0
}

// 合并 rclone.conf 中的 INI 配置节，防止多存储池凭证覆盖踩踏
func mergeRcloneConfigs(existingContent, newContent string) string {
	parseSections := func(content string) (map[string]string, []string) {
		sections := make(map[string]string)
		var order []string
		lines := strings.Split(content, "\n")
		var currentSection string
		var currentLines []string

		for _, line := range lines {
			trimmed := strings.TrimSpace(line)
			if strings.HasPrefix(trimmed, "[") && strings.HasSuffix(trimmed, "]") {
				if currentSection != "" {
					sections[currentSection] = strings.Join(currentLines, "\n")
				}
				currentSection = trimmed
				currentLines = []string{line}
				order = append(order, currentSection)
			} else {
				if currentSection != "" {
					currentLines = append(currentLines, line)
				}
			}
		}
		if currentSection != "" {
			sections[currentSection] = strings.Join(currentLines, "\n")
		}
		return sections, order
	}

	existSecs, existOrder := parseSections(existingContent)
	newSecs, _ := parseSections(newContent)

	// 如果新上传内容没有任何配置节，返回原有配置，避免清空
	if len(newSecs) == 0 {
		return existingContent
	}

	// 合并：新配置覆盖或追加到老配置
	for secName, secVal := range newSecs {
		if _, exists := existSecs[secName]; !exists {
			existOrder = append(existOrder, secName)
		}
		existSecs[secName] = secVal
	}

	// 重新按顺序组装
	var result []string
	for _, secName := range existOrder {
		if val, exists := existSecs[secName]; exists {
			result = append(result, val)
		}
	}
	return strings.Join(result, "\n")
}

// ------------------------------------------------------------------------------
// 9. REST API 路由与控制器分发
// ------------------------------------------------------------------------------

func setupRoutes() http.Handler {
	mux := http.NewServeMux()

	// A. 密码物理校验接口
	mux.HandleFunc("/api/config/verify-password", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}

		if r.Method == "POST" {
			var req struct {
				Password string `json:"password"`
			}
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				http.Error(w, "无效的 JSON 数据", http.StatusBadRequest)
				return
			}

			configMutex.Lock()
			actualPassword := currentConfig.BackupPassword
			configMutex.Unlock()

			matched := (req.Password == actualPassword)
			json.NewEncoder(w).Encode(map[string]bool{"matched": matched})
			return
		}
		http.Error(w, "方法不允许", http.StatusMethodNotAllowed)
	})

	// B. rclone.conf 配置接收与动态写入
	mux.HandleFunc("/api/config/rclone", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}

		if r.Method == "POST" {
			var req struct {
				Content string `json:"content"`
			}
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				http.Error(w, "无效的 JSON 数据", http.StatusBadRequest)
				return
			}

			finalContent := req.Content
			existingBytes, err := os.ReadFile("/config/rclone.conf")
			if err == nil {
				finalContent = mergeRcloneConfigs(string(existingBytes), req.Content)
			}

			err = os.WriteFile("/config/rclone.conf", []byte(finalContent), 0644)
			if err != nil {
				http.Error(w, "保存 rclone.conf 凭证失败: "+err.Error(), http.StatusInternalServerError)
				return
			}

			configMutex.Lock()
			pwd := currentConfig.BackupPassword
			configMutex.Unlock()

			// 自动创建加密包装
			autoWrapCloudRemotes(pwd)

			json.NewEncoder(w).Encode(map[string]string{"status": "ok", "message": "云端凭证已成功保存并立即加载！"})
			return
		}
		http.Error(w, "方法不允许", http.StatusMethodNotAllowed)
	})

	// C. GFS 清理超期文件预览接口
	mux.HandleFunc("/api/config/preview-cleanup", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}

		if r.Method == "POST" {
			var req struct {
				LocalDBRule      string `json:"local_db_rule"`
				LocalSysRule     string `json:"local_sys_rule"`
				TelegramDBRule   string `json:"telegram_db_rule"`
				TelegramSysRule  string `json:"telegram_sys_rule"`
				OneDriveDBRule   string `json:"onedrive_db_rule"`
				OneDriveSysRule  string `json:"onedrive_sys_rule"`
				GDriveDBRule     string `json:"gdrive_db_rule"`
				GDriveSysRule    string `json:"gdrive_sys_rule"`
				PikPakDBRule     string `json:"pikpak_db_rule"`
				PikPakSysRule    string `json:"pikpak_sys_rule"`
			}
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				http.Error(w, "无效的 JSON 数据", http.StatusBadRequest)
				return
			}

			type CleanupPreviewItem struct {
				Pool     string `json:"pool"`
				Filename string `json:"filename"`
			}
			var previewList []CleanupPreviewItem

			// 1. 本地
			if files, err := readLocalFiles("/config/local_backup/hourly_db"); err == nil {
				toDel := filterGFSFilesByRule(files, req.LocalDBRule)
				for _, f := range toDel {
					previewList = append(previewList, CleanupPreviewItem{Pool: "本地储存池 (数据库热备)", Filename: f})
				}
			}
			if files, err := readLocalFiles("/config/local_backup/system_backup"); err == nil {
				toDel := filterGFSFilesByRule(files, req.LocalSysRule)
				for _, f := range toDel {
					previewList = append(previewList, CleanupPreviewItem{Pool: "本地储存池 (系统配置)", Filename: f})
				}
			}

			// 2. 云盘
			activeRemotes := getActiveCloudRemotes()
			for _, remote := range activeRemotes {
				remoteType := getRemoteType(remote)
				dbRule := ""
				sysRule := ""
				poolName := ""

				switch remoteType {
				case "onedrive":
					dbRule = req.OneDriveDBRule
					sysRule = req.OneDriveSysRule
					poolName = "OneDrive 云盘"
				case "gdrive":
					dbRule = req.GDriveDBRule
					sysRule = req.GDriveSysRule
					poolName = "Google Drive"
				case "pikpak":
					dbRule = req.PikPakDBRule
					sysRule = req.PikPakSysRule
					poolName = "PikPak"
				default:
					continue
				}

				if files, err := getRcloneFiles(remote + "backup/hourly_db"); err == nil {
					toDel := filterGFSFilesByRule(files, dbRule)
					for _, f := range toDel {
						previewList = append(previewList, CleanupPreviewItem{Pool: poolName + " (数据库热备)", Filename: f})
					}
				}
				if files, err := getRcloneFiles(remote + "backup/system_backup"); err == nil {
					toDel := filterGFSFilesByRule(files, sysRule)
					for _, f := range toDel {
						previewList = append(previewList, CleanupPreviewItem{Pool: poolName + " (系统配置)", Filename: f})
					}
				}
			}

			// 3. Telegram
			var tgRecords []TelegramRecord
			if data, err := os.ReadFile("/config/telegram_history.json"); err == nil {
				json.Unmarshal(data, &tgRecords)
			}
			var tgDbFiles, tgSysFiles []FileInfo
			for _, r := range tgRecords {
				isHourly := strings.HasPrefix(r.Path, "db_hourly_")
				fi := FileInfo{Name: r.Path, Size: r.Size, ModTime: r.ModTime}
				if isHourly {
					tgDbFiles = append(tgDbFiles, fi)
				} else {
					tgSysFiles = append(tgSysFiles, fi)
				}
			}
			tgDbDel := filterGFSFilesByRule(tgDbFiles, req.TelegramDBRule)
			for _, f := range tgDbDel {
				previewList = append(previewList, CleanupPreviewItem{Pool: "Telegram 密道 (数据库热备)", Filename: f})
			}
			tgSysDel := filterGFSFilesByRule(tgSysFiles, req.TelegramSysRule)
			for _, f := range tgSysDel {
				previewList = append(previewList, CleanupPreviewItem{Pool: "Telegram 密道 (系统配置)", Filename: f})
			}

			json.NewEncoder(w).Encode(previewList)
			return
		}
		http.Error(w, "方法不允许", http.StatusMethodNotAllowed)
	})

	// D. 本地拉取助手一键 ZIP 下载通道
	mux.HandleFunc("/api/local-pull/download-zip", func(w http.ResponseWriter, r *http.Request) {
		tokenParam := r.URL.Query().Get("token")
		localPath := r.URL.Query().Get("path")

		configMutex.Lock()
		validToken := currentConfig.DownloadToken
		configMutex.Unlock()

		if tokenParam == "" || tokenParam != validToken {
			http.Error(w, "未授权的拉取助手请求！", http.StatusUnauthorized)
			return
		}

		if localPath == "" {
			localPath = `D:\Backup\VPS_Backup`
		}

		// Windows UTF-8 with BOM 标识
		bom := []byte{0xEF, 0xBB, 0xBF}

		vpsOrigin := "http://" + r.Host
		if r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https" {
			vpsOrigin = "https://" + r.Host
		}

		syncScript := `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
# Windows 本地备份拉取与自适应删增同步脚本 (sync_to_local.ps1)
param (
    [switch]$Silent = $false
)

$LocalBackupDir = "` + localPath + `"
$VpsOrigin = "` + vpsOrigin + `"
$Token = "` + tokenParam + `"

if (-not (Test-Path $LocalBackupDir)) {
    New-Item -ItemType Directory -Force -Path $LocalBackupDir | Out-Null
}

if (-not $Silent) {
    Write-Host "==================================================================" -ForegroundColor Cyan
    Write-Host "         Shield-Backup 本地冷备份自适应增删同步" -ForegroundColor Cyan
    Write-Host "==================================================================" -ForegroundColor Cyan
    Write-Host ">>> 正在连接 VPS 请求比对逻辑差异清单大厅..." -ForegroundColor Yellow
}

$LocalFilesList = @()
if (Test-Path $LocalBackupDir) {
    $LocalFilesList = Get-ChildItem -Path $LocalBackupDir -File | ForEach-Object {
        [PSCustomObject]@{
            name = $_.Name
            size = $_.Length
        }
    }
}

$ManifestUrl = "$VpsOrigin/api/local-pull/manifest?token=$Token"
$Headers = @{ "Content-Type" = "application/json" }
$Body = @{ files = @($LocalFilesList) } | ConvertTo-Json -Depth 4

try {
    $Response = Invoke-RestMethod -Uri $ManifestUrl -Method Post -Headers $Headers -Body $Body
} catch {
    if (-not $Silent) {
        Write-Host "❌ 无法连接到 VPS 差异清单服务，或 API Token 验证错误！" -ForegroundColor Red
        Write-Host "错误信息: $_" -ForegroundColor Red
    }
    exit 1
}

$Downloads = $Response.downloads
$Deletes = $Response.deletes

# 1. 自动物理删除已移出队列的淘汰包
$DeleteCount = 0
if ($Deletes) {
    foreach ($FileToDelete in $Deletes) {
        $FilePath = Join-Path $LocalBackupDir $FileToDelete
        if (Test-Path $FilePath) {
            if (-not $Silent) { Write-Host ">>> 快照已在 VPS 清单中淘汰，正在删除本地物理包: $FileToDelete" -ForegroundColor Red }
            Remove-Item -Path $FilePath -Force
            $DeleteCount++
        }
    }
}

# 2. 流式 WebRequest 安全下载新增包
$DownloadCount = 0
$DownloadSize = 0
if ($Downloads) {
    foreach ($FileToDownload in $Downloads) {
        $FileName = $FileToDownload.Path
        $FileSize = $FileToDownload.Size
        $LocalPath = Join-Path $LocalBackupDir $FileName
        
        if (-not $Silent) { Write-Host ">>> 发现新增差异快照包，正在流式下载: $FileName ..." -ForegroundColor Yellow }
        $DownloadUrl = "$VpsOrigin/api/backups/download?file=$FileName&token=$Token"
        try {
            Invoke-WebRequest -Uri $DownloadUrl -OutFile $LocalPath
            $DownloadCount++
            $DownloadSize += $FileSize
            if (-not $Silent) { Write-Host "  [OK] 下载成功 (大小: $([Math]::Round($FileSize / 1MB, 2)) MB)" -ForegroundColor Green }
        } catch {
            if (-not $Silent) { Write-Host "  [ERROR] 下载文件 $FileName 失败！" -ForegroundColor Red }
        }
    }
}

# 3. 漂浮式系统通知（静默启动下仍会显示）
$NotifyMessage = ""
if ($DownloadCount -gt 0 -or $DeleteCount -gt 0) {
    $NotifyMessage = "冷备同步已成功完成！
新增下载了 $DownloadCount 个快照包 (共 $([Math]::Round($DownloadSize / 1MB, 2)) MB)。
本地物理清理了 $DeleteCount 个过期包。"
} else {
    $NotifyMessage = "冷备同步比对完毕。
本地已是最新状态，无差异快照需要拉取。"
}

function Show-Notification {
    param (
        [string]$Title,
        [string]$Message
    )
    try {
        Add-Type -AssemblyName System.Windows.Forms
        $balloon = New-Object System.Windows.Forms.NotifyIcon
        $path = (Get-Process -id $pid).Path
        $balloon.Icon = [System.Drawing.Icon]::ExtractAssociatedIcon($path)
        $balloon.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::Info
        $balloon.BalloonTipText = $Message
        $balloon.BalloonTipTitle = $Title
        $balloon.Visible = $true
        $balloon.ShowBalloonTip(5000)
        Start-Sleep -Seconds 2
        $balloon.Dispose()
    } catch {}
}

Show-Notification -Title "Shield-Backup 本地同步简报" -Message $NotifyMessage

if (-not $Silent) {
    Write-Host "🎉 同步完成！新增下载 $DownloadCount 个快照，本地清理 $DeleteCount 个过期快照。" -ForegroundColor Green
    Write-Host "==================================================================" -ForegroundColor Cyan
}
`

		setupScript := `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
# Windows 任务计划程序一键注册脚本 (setup_task.ps1)

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host ">>> 正在申请管理员权限以注册每日开机任务..." -ForegroundColor Yellow
    Start-Process powershell -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File ""$PSCommandPath""" -Verb RunAs
    exit
}

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$SyncScriptPath = Join-Path $ScriptDir "sync_to_local.ps1"
$VbsScriptPath = Join-Path $ScriptDir "run_silent.vbs"

if (-not (Test-Path $SyncScriptPath)) {
    Write-Host "❌ 错误：在同一目录下未找到 sync_to_local.ps1 同步脚本！" -ForegroundColor Red
    Read-Host "按回车键退出..."
    exit 1
}
if (-not (Test-Path $VbsScriptPath)) {
    Write-Host "❌ 错误：在同一目录下未找到 run_silent.vbs 隐藏辅助脚本！" -ForegroundColor Red
    Read-Host "按回车键退出..."
    exit 1
}

$TaskName = "ShieldBackupSyncTask"
$Action = New-ScheduledTaskAction -Execute "wscript.exe" -Argument """$VbsScriptPath"" ""$SyncScriptPath"""
$Trigger = New-ScheduledTaskTrigger -Daily -At "00:05"
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable

Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -User "NT AUTHORITY\SYSTEM" -Force | Out-Null

Write-Host "==================================================================" -ForegroundColor Green
Write-Host "🎉 成功！已将同步脚本注册至 Windows 任务计划程序中。" -ForegroundColor Green
Write-Host "任务名称: $TaskName" -ForegroundColor Gray
Write-Host "运行方式: 通过 run_silent.vbs 实现完全后台无闪烁静默同步。" -ForegroundColor Gray
Write-Host "运行时间: 每日 00:05 触发。开机若错过时间将立刻自动补运行。" -ForegroundColor Gray
Write-Host "==================================================================" -ForegroundColor Green
Read-Host "设置成功！按回车键退出..."
`

		w.Header().Set("Content-Type", "application/zip")
		w.Header().Set("Content-Disposition", "attachment; filename=shield-backup-local-puller.zip")

		archive := zip.NewWriter(w)
		defer archive.Close()

		fSync, err1 := archive.Create("sync_to_local.ps1")
		if err1 == nil {
			fSync.Write(bom)
			fSync.Write([]byte(syncScript))
		}

		fSetup, err2 := archive.Create("setup_task.ps1")
		if err2 == nil {
			fSetup.Write(bom)
			fSetup.Write([]byte(setupScript))
		}

		fVbs, err3 := archive.Create("run_silent.vbs")
		if err3 == nil {
			vbsScript := `Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "powershell.exe -ExecutionPolicy Bypass -File """ & WScript.Arguments(0) & """ -Silent", 0, False
`
			fVbs.Write([]byte(vbsScript))
		}
	})

	// E. 外部脚本安全获取活跃备份列表 API
	mux.HandleFunc("/api/backups/list", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Access-Control-Allow-Origin", "*")

		tokenParam := r.URL.Query().Get("token")
		configMutex.Lock()
		validToken := currentConfig.DownloadToken
		configMutex.Unlock()

		if tokenParam == "" || tokenParam != validToken {
			http.Error(w, "未授权的列表获取请求！", http.StatusUnauthorized)
			return
		}

		var files []FileInfo
		hFiles, _ := readLocalFiles("/config/local_backup/hourly_db")
		sFiles, _ := readLocalFiles("/config/local_backup/system_backup")
		files = append(hFiles, sFiles...)

		sort.Slice(files, func(i, j int) bool {
			return files[i].ModTime.After(files[j].ModTime)
		})

		json.NewEncoder(w).Encode(files)
	})

	// F. 本地冷备客户端单独下载通道
	mux.HandleFunc("/api/backups/download", func(w http.ResponseWriter, r *http.Request) {
		fileParam := r.URL.Query().Get("file")
		tokenParam := r.URL.Query().Get("token")

		configMutex.Lock()
		validToken := currentConfig.DownloadToken
		configMutex.Unlock()

		if tokenParam == "" || tokenParam != validToken {
			http.Error(w, "未授权的下载请求，Token 验证失败！", http.StatusUnauthorized)
			return
		}

		var localPath string
		var cleanName string

		if fileParam == "latest" || fileParam == "" {
			var allFiles []FileInfo
			hFiles, _ := readLocalFiles("/config/local_backup/hourly_db")
			sFiles, _ := readLocalFiles("/config/local_backup/system_backup")
			allFiles = append(hFiles, sFiles...)

			if len(allFiles) == 0 {
				http.Error(w, "没有找到任何快照文件", http.StatusNotFound)
				return
			}

			sort.Slice(allFiles, func(i, j int) bool {
				return allFiles[i].ModTime.After(allFiles[j].ModTime)
			})

			cleanName = allFiles[0].Name
			if strings.HasPrefix(cleanName, "db_hourly_") {
				localPath = filepath.Join("/config/local_backup/hourly_db", cleanName)
			} else {
				localPath = filepath.Join("/config/local_backup/system_backup", cleanName)
			}
		} else {
			cleanName = filepath.Base(fileParam)
			if cleanName == "restore_system.sh" {
				localPath = "/app/restore_system.sh"
			} else if cleanName == "restore_db.sh" {
				localPath = "/app/restore_db.sh"
			} else if strings.HasPrefix(cleanName, "db_hourly_") {
				localPath = filepath.Join("/config/local_backup/hourly_db", cleanName)
			} else if strings.HasPrefix(cleanName, "system_") {
				localPath = filepath.Join("/config/local_backup/system_backup", cleanName)
			} else if strings.HasPrefix(cleanName, "restore_system_") {
				// 支持下载恢复脚本
				localPath = filepath.Join("/config/local_backup/system_backup", cleanName)
			} else if strings.HasPrefix(cleanName, "restore_db_") {
				localPath = filepath.Join("/config/local_backup/hourly_db", cleanName)
			} else {
				http.Error(w, "不允许下载该类型的文件！", http.StatusForbidden)
				return
			}
		}

		if _, err := os.Stat(localPath); os.IsNotExist(err) {
			http.Error(w, "找不到该快照文件", http.StatusNotFound)
			return
		}

		w.Header().Set("Content-Disposition", "attachment; filename="+cleanName)
		http.ServeFile(w, r, localPath)
	})

	// G. 全局状态指标 API
	mux.HandleFunc("/api/status", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Access-Control-Allow-Origin", "*")

		if r.Method != "GET" {
			http.Error(w, "方法不允许", http.StatusMethodNotAllowed)
			return
		}

		lastBackupText := "未检测到备份"
		localHourlyDir := "/config/local_backup/hourly_db"
		if entries, err := os.ReadDir(localHourlyDir); err == nil && len(entries) > 0 {
			var latestTime time.Time
			for _, entry := range entries {
				if info, err := entry.Info(); err == nil {
					if strings.HasPrefix(entry.Name(), "restore_") {
						continue
					}
					if info.ModTime().After(latestTime) {
						latestTime = info.ModTime()
					}
				}
			}
			if !latestTime.IsZero() {
				minutesAgo := int(time.Since(latestTime).Minutes())
				if minutesAgo < 60 {
					lastBackupText = strconv.Itoa(minutesAgo) + " 分钟前"
				} else {
					lastBackupText = strconv.Itoa(minutesAgo/60) + " 小时前"
				}
			}
		}

		localSnapCount := 0
		if files, err := readLocalFiles("/config/local_backup/hourly_db"); err == nil {
			localSnapCount += len(files)
		}
		if files, err := readLocalFiles("/config/local_backup/system_backup"); err == nil {
			localSnapCount += len(files)
		}

		configMutex.Lock()
		assetFileCount := 2 + len(currentConfig.CustomPaths)
		tgToken := currentConfig.TelegramBotToken
		apiURL := currentConfig.TelegramApiURL
		configMutex.Unlock()
		if apiURL == "" {
			apiURL = "https://api.telegram.org"
		}
		apiURL = strings.TrimSuffix(apiURL, "/")

		tgStatus := "unconfigured"
		if tgToken != "" && tgToken != "your_telegram_bot_token_here" {
			client := http.Client{Timeout: 3 * time.Second}
			resp, err := client.Get(apiURL + "/bot" + tgToken + "/getMe")
			if err == nil && resp.StatusCode == http.StatusOK {
				tgStatus = "connected"
			} else {
				tgStatus = "error"
			}
			if resp != nil {
				resp.Body.Close()
			}
		}

		onedriveStatus := "unconfigured"
		gdriveStatus := "unconfigured"
		pikpakStatus := "unconfigured"

		activeRemotes := getActiveCloudRemotes()
		for _, r := range activeRemotes {
			rClean := strings.TrimSuffix(r, ":")
			rType := getRemoteType(rClean)

			// 转换为基础的、未加密的底层 remote 名称，以保障即使云端子目录不存在根目录也永远通
			testRemote := r
			if rClean == "onedrive-crypt" {
				testRemote = "my-onedrive:"
			} else if rClean == "gdrive-crypt" {
				testRemote = "gdrive:"
			} else if rClean == "pikpak-crypt" {
				testRemote = "pikpak:"
			}

			cmd := exec.Command("rclone", "lsd", testRemote, "--config", "/config/rclone.conf")
			status := "error"
			if cmd.Run() == nil {
				status = "connected"
			}

			switch rType {
			case "onedrive":
				onedriveStatus = status
			case "gdrive":
				gdriveStatus = status
			case "pikpak":
				pikpakStatus = status
			}
		}

		var report HealthReport
		if data, err := os.ReadFile("/config/health_report.json"); err == nil {
			json.Unmarshal(data, &report)
		}

		statusData := map[string]interface{}{
			"last_backup_time":  lastBackupText,
			"snapshot_count":    localSnapCount,
			"asset_file_count":  assetFileCount,
			"telegram_status":   tgStatus,
			"onedrive_status":   onedriveStatus,
			"gdrive_status":     gdriveStatus,
			"pikpak_status":     pikpakStatus,
			"download_token":    currentConfig.DownloadToken,
			"health_report":     report,
			// 新增仪表盘字段
			"db_next_time":          dbNextTime.Unix(),
			"db_last_start_time":    dbLastStartTime.Unix(),
			"db_last_end_time":      dbLastEndTime.Unix(),
			"db_last_status":        dbLastStatus,
			"db_last_log":           dbLastLog,
			"sys_next_time":         sysNextTime.Unix(),
			"sys_last_start_time":   sysLastStartTime.Unix(),
			"sys_last_end_time":     sysLastEndTime.Unix(),
			"sys_last_status":       sysLastStatus,
			"sys_last_log":          sysLastLog,
			"last_sync_time":        lastLocalPullSyncTime.Unix(),
		}
		json.NewEncoder(w).Encode(statusData)
	})

	// H. 多源快照列表管理 API
	mux.HandleFunc("/api/backups", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}

		// 1. 获取快照列表
		if r.Method == "GET" {
			source := r.URL.Query().Get("source")
			var files []FileInfo

			if source == "local_pull" {
				var items []LocalPullItem
				data, err := os.ReadFile("/config/local_pull_manifest.json")
				if err == nil {
					json.Unmarshal(data, &items)
				}
				if items == nil {
					items = []LocalPullItem{}
				}
				json.NewEncoder(w).Encode(items)
				return
			}

			if source == "local" {
				var hFiles, sFiles []FileInfo
				hFiles, _ = readLocalFiles("/config/local_backup/hourly_db")
				sFiles, _ = readLocalFiles("/config/local_backup/system_backup")
				files = append(hFiles, sFiles...)
			} else if source == "telegram" {
				var records []TelegramRecord
				if data, err := os.ReadFile("/config/telegram_history.json"); err == nil {
					json.Unmarshal(data, &records)
				}
				
				exemptionsPath := "/config/telegram_exemptions.json"
				var exemptions []string
				if data, err := os.ReadFile(exemptionsPath); err == nil {
					json.Unmarshal(data, &exemptions)
				}
				exMap := make(map[string]bool)
				for _, name := range exemptions {
					exMap[name] = true
				}

				for _, r := range records {
					fname := r.Path
					cleanName := strings.ReplaceAll(fname, "_keep_", "")
					if exMap[cleanName] {
						if strings.HasSuffix(cleanName, ".tar.gz.enc") {
							fname = strings.Replace(cleanName, ".tar.gz.enc", "_keep_.tar.gz.enc", 1)
						} else if strings.HasSuffix(cleanName, ".enc") {
							fname = strings.Replace(cleanName, ".enc", "_keep_.enc", 1)
						} else {
							fname = cleanName + "_keep_"
						}
					}
					files = append(files, FileInfo{
						Name:    fname,
						Size:    r.Size,
						ModTime: r.ModTime,
					})
				}
			} else {
				remoteName := ""
				activeRemotes := getActiveCloudRemotes()
				for _, r := range activeRemotes {
					rClean := strings.TrimSuffix(r, ":")
					rType := getRemoteType(rClean)
					if rType == source {
						remoteName = r
						break
					}
				}

				if remoteName != "" {
					var hFiles, sFiles []FileInfo
					hFiles, _ = getRcloneFiles(remoteName + "backup/hourly_db")
					sFiles, _ = getRcloneFiles(remoteName + "backup/system_backup")
					files = append(hFiles, sFiles...)
				}
			}

			sort.Slice(files, func(i, j int) bool {
				return files[i].ModTime.After(files[j].ModTime)
			})

			json.NewEncoder(w).Encode(files)
			return
		}

		// 2. 删除指定快照 (支持多选批量删除)
		if r.Method == "DELETE" {
			var req struct {
				Filename  string   `json:"filename"`
				Filenames []string `json:"filenames"`
				Source    string   `json:"source"`
			}
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				http.Error(w, "无效的 JSON 数据", http.StatusBadRequest)
				return
			}

			filesToDel := req.Filenames
			if len(filesToDel) == 0 && req.Filename != "" {
				filesToDel = []string{req.Filename}
			}

			successCount := 0
			for _, fname := range filesToDel {
				cleanName := filepath.Base(fname)
				isHourly := strings.HasPrefix(cleanName, "db_hourly_")
				isSys := strings.HasPrefix(cleanName, "system_")

				if !isHourly && !isSys {
					continue
				}

				if req.Source == "local_pull" {
					removeLocalPullManifest(cleanName)
					if strings.Contains(cleanName, "_keep_") {
						var localPath string
						if isHourly {
							localPath = filepath.Join("/config/local_backup/hourly_db", cleanName)
						} else {
							localPath = filepath.Join("/config/local_backup/system_backup", cleanName)
						}
						os.Remove(localPath)
					}
					successCount++
				} else if req.Source == "local" {
					var localPath string
					if isHourly {
						localPath = filepath.Join("/config/local_backup/hourly_db", cleanName)
					} else {
						localPath = filepath.Join("/config/local_backup/system_backup", cleanName)
					}
					os.Remove(localPath)
					successCount++
				} else if req.Source == "telegram" {
					cleanupTelegramFile(cleanName)
					successCount++
				} else {
					remoteName := ""
					activeRemotes := getActiveCloudRemotes()
					for _, r := range activeRemotes {
						rClean := strings.TrimSuffix(r, ":")
						rType := getRemoteType(rClean)
						if rType == req.Source {
							remoteName = r
							break
						}
					}

					if remoteName != "" {
						targetDir := "backup/hourly_db/"
						if isSys {
							targetDir = "backup/system_backup/"
						}
						exec.Command("rclone", "deletefile", remoteName+targetDir+cleanName, "--config", "/config/rclone.conf").Run()
						successCount++
					}
				}
			}

			json.NewEncoder(w).Encode(map[string]interface{}{
				"status":  "ok",
				"message": fmt.Sprintf("成功删除 %d 个指定的备份快照", successCount),
			})
			return
		}

		// 3. 一键恢复指定的快照 (支持多选批量恢复)
		if r.Method == "POST" {
			var req struct {
				Filename  string   `json:"filename"`
				Filenames []string `json:"filenames"`
				Source    string   `json:"source"`
			}
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				http.Error(w, "无效的 JSON 数据", http.StatusBadRequest)
				return
			}

			filesToRestore := req.Filenames
			if len(filesToRestore) == 0 && req.Filename != "" {
				filesToRestore = []string{req.Filename}
			}

			// 如果是单个系统快照，走原来的单系统还原逻辑
			isBatch := len(filesToRestore) > 1
			firstFile := ""
			if len(filesToRestore) > 0 {
				firstFile = filesToRestore[0]
			}
			cleanName := filepath.Base(firstFile)
			isSys := strings.HasPrefix(cleanName, "system_")

			configMutex.Lock()
			pwd := currentConfig.BackupPassword
			configMutex.Unlock()

			if !isBatch && isSys {
				goto restoreSystemLabel
			}

			// =========================================================
			// 数据库一键还原 / 批量还原逻辑
			// =========================================================
			{
				successCount := 0
				var errMsgs []string

				for _, fname := range filesToRestore {
					cName := filepath.Base(fname)
					isHourly := strings.HasPrefix(cName, "db_hourly_")
					if !isHourly {
						errMsgs = append(errMsgs, fmt.Sprintf("%s: 批量模式下不支持非数据库快照还原", cName))
						continue
					}

					localFilePath := filepath.Join("/config/local_backup/hourly_db", cName)
					if req.Source != "local" {
						localFilePath = filepath.Join("/tmp", cName)
						remoteName := ""
						activeRemotes := getActiveCloudRemotes()
						for _, r := range activeRemotes {
							rClean := strings.TrimSuffix(r, ":")
							rType := getRemoteType(rClean)
							if rType == req.Source {
								remoteName = r
								break
							}
						}

						if remoteName != "" {
							log.Printf("[RESTORE] 正在从云端 %s 拷贝拉取热备包 %s ...", req.Source, cName)
							cmd := exec.Command("rclone", "copyto", remoteName+"backup/hourly_db/"+cName, localFilePath, "--config", "/config/rclone.conf")
							if err := cmd.Run(); err != nil {
								errMsgs = append(errMsgs, fmt.Sprintf("%s: 无法从云端提取文件: %v", cName, err))
								continue
							}
							defer os.Remove(localFilePath)
						}
					}

					log.Printf("[RESTORE] 正在解密还原热备数据库 %s ...", cName)
					restoreTmp := "/tmp/restore_db_work"
					os.RemoveAll(restoreTmp)
					os.MkdirAll(restoreTmp, 0755)

					cmdDec := exec.Command("openssl", "enc", "-d", "-aes-256-cbc", "-salt", "-pbkdf2", "-pass", "pass:"+pwd, "-in", localFilePath)
					cmdTar := exec.Command("tar", "-xz", "-C", restoreTmp)

					rPipe, wPipe := io.Pipe()
					cmdDec.Stdout = wPipe
					cmdTar.Stdin = rPipe

					cmdDec.Start()
					cmdTar.Start()
					cmdDec.Wait()
					wPipe.Close()
					cmdTar.Wait()

					vSrc := filepath.Join(restoreTmp, "vaultwarden/data/db.sqlite3")
					lSrc := filepath.Join(restoreTmp, "ldap/data/users.db")

					restoredThisTime := 0
					if _, err := os.Stat(vSrc); err == nil {
						exec.Command("cp", "-f", vSrc, "/vaultwarden_data/db.sqlite3").Run()
						restoredThisTime++
					}
					if _, err := os.Stat(lSrc); err == nil {
						exec.Command("cp", "-f", lSrc, "/lldap_data/users.db").Run()
						restoredThisTime++
					}

					os.RemoveAll(restoreTmp)

					if restoredThisTime > 0 {
						successCount++
					} else {
						errMsgs = append(errMsgs, fmt.Sprintf("%s: 备份包内未发现核心 SQLite 数据库资产", cName))
					}
				}

				if successCount == 0 && len(errMsgs) > 0 {
					http.Error(w, "数据库恢复全部失败: "+strings.Join(errMsgs, "; "), http.StatusInternalServerError)
					return
				}

				msg := fmt.Sprintf("数据库批量恢复成功 %d 个，失败 %d 个。", successCount, len(errMsgs))
				if len(errMsgs) > 0 {
					msg += " 错误列表: " + strings.Join(errMsgs, "; ")
				}
				json.NewEncoder(w).Encode(map[string]string{
					"status":  "ok",
					"message": msg,
				})
				return
			}

		restoreSystemLabel:

			// B. 处理系统配置还原 (system_full 或 system_inc)
			if isSys {
				log.Printf("[RESTORE] 开始从网页端还原系统配置: %s ...", cleanName)

				// 1. 创建安全回滚点
				rollbackName := fmt.Sprintf("system_rollback_before_restore_%s.tar.gz.enc", time.Now().Format("20060102_150405"))
				rollbackPath := filepath.Join("/config/local_backup/system_backup", rollbackName)
				log.Printf("[RESTORE] 正在创建安全回滚快照: %s ...", rollbackName)

				exec.Command("mkdir", "-p", "/config/local_backup/system_backup").Run()
				cmdRoll := exec.Command("/bin/bash", "-c", fmt.Sprintf(
					"tar --exclude='*.log' --exclude='backup-agent/config' -cz -C /source_stacks . | openssl enc -aes-256-cbc -salt -pbkdf2 -pass pass:%s -out %s",
					pwd, rollbackPath,
				))
				if err := cmdRoll.Run(); err != nil {
					log.Printf("[RESTORE] 创建回滚快照失败: %v", err)
				} else {
					log.Printf("[RESTORE] 回滚快照创建成功: %s", rollbackPath)
				}

				// 2. 拉取云端备份到本地 (如果是云端)
				localFilePath := filepath.Join("/config/local_backup/system_backup", cleanName)
				if req.Source != "local" {
					localFilePath = filepath.Join("/tmp", cleanName)
					remoteName := ""
					activeRemotes := getActiveCloudRemotes()
					for _, r := range activeRemotes {
						rClean := strings.TrimSuffix(r, ":")
						rType := getRemoteType(rClean)
						if rType == req.Source {
							remoteName = r
							break
						}
					}

					if remoteName != "" {
						log.Printf("[RESTORE] 正在从云端 %s 拷贝拉取系统配置包 %s ...", req.Source, cleanName)
						cmd := exec.Command("rclone", "copyto", remoteName+"backup/system_backup/"+cleanName, localFilePath, "--config", "/config/rclone.conf")
						if err := cmd.Run(); err != nil {
							http.Error(w, "无法从云端提取备份文件: "+err.Error(), http.StatusInternalServerError)
							return
						}
						defer os.Remove(localFilePath)
					}
				}

				// 3. 执行还原
				// 增量链自动拼接还原
				if strings.HasPrefix(cleanName, "system_inc_") {
					re := regexp.MustCompile(`system_inc_(\d{8}_\d{6})`)
					match := re.FindStringSubmatch(cleanName)
					if len(match) > 0 {
						// 寻找当月 full 包
						t, _ := parseTimeFromFilename(cleanName)
						monthStamp := t.Format("200601")
						fullBackupName := fmt.Sprintf("system_full_%s.tar.gz.enc", monthStamp)
						fullLocalPath := filepath.Join("/config/local_backup/system_backup", fullBackupName)

						if _, err := os.Stat(fullLocalPath); os.IsNotExist(err) && req.Source != "local" {
							// 从云端尝试获取
							fullCloudPath := "/tmp/" + fullBackupName
							remoteName := ""
							activeRemotes := getActiveCloudRemotes()
							for _, r := range activeRemotes {
								rClean := strings.TrimSuffix(r, ":")
								rType := getRemoteType(rClean)
								if rType == req.Source {
									remoteName = r
									break
								}
							}
							if remoteName != "" {
								cmd := exec.Command("rclone", "copyto", remoteName+"backup/system_backup/"+fullBackupName, fullCloudPath, "--config", "/config/rclone.conf")
								if cmd.Run() == nil {
									fullLocalPath = fullCloudPath
									defer os.Remove(fullCloudPath)
								}
							}
						}

						if _, err := os.Stat(fullLocalPath); err == nil {
							log.Printf("[RESTORE] 正在还原依赖的月度全量底座: %s ...", fullBackupName)
							cmdDec := exec.Command("openssl", "enc", "-d", "-aes-256-cbc", "-salt", "-pbkdf2", "-pass", "pass:"+pwd, "-in", fullLocalPath)
							cmdTar := exec.Command("tar", "-xz", "-C", "/source_stacks")
							rPipe, wPipe := io.Pipe()
							cmdDec.Stdout = wPipe
							cmdTar.Stdin = rPipe
							cmdDec.Start()
							cmdTar.Start()
							cmdDec.Wait()
							wPipe.Close()
							cmdTar.Wait()
						} else {
							http.Error(w, "无法找到依赖的月度全量底座备份包: "+fullBackupName, http.StatusInternalServerError)
							return
						}
					}
				}

				// 还原当前的备份包 (覆盖)
				log.Printf("[RESTORE] 正在还原当前备份快照包: %s ...", cleanName)
				cmdDec := exec.Command("openssl", "enc", "-d", "-aes-256-cbc", "-salt", "-pbkdf2", "-pass", "pass:"+pwd, "-in", localFilePath)
				cmdTar := exec.Command("tar", "-xz", "-C", "/source_stacks")
				rPipe, wPipe := io.Pipe()
				cmdDec.Stdout = wPipe
				cmdTar.Stdin = rPipe
				cmdDec.Start()
				cmdTar.Start()
				cmdDec.Wait()
				wPipe.Close()
				cmdTar.Wait()

				log.Printf("[RESTORE] 系统配置还原成功！")
				json.NewEncoder(w).Encode(map[string]string{
					"status":  "ok",
					"message": fmt.Sprintf("系统配置已成功恢复！已自动创建安全回滚点 %s。由于网页容器虚拟化限制，请登录宿主机运行 restore_system.sh 或在宿主机上重启对应的项目容器以拉起新配置。", rollbackName),
				})
				return
			}
		}

		http.Error(w, "方法不允许", http.StatusMethodNotAllowed)
	})

	// I. 配置文件交互 API
	mux.HandleFunc("/api/config", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}

		if r.Method == "GET" {
			configMutex.Lock()
			cfg := currentConfig
			configMutex.Unlock()

			if cfg.TelegramBotToken != "your_telegram_bot_token_here" && len(cfg.TelegramBotToken) > 6 {
				cfg.TelegramBotToken = cfg.TelegramBotToken[:3] + "********************" + cfg.TelegramBotToken[len(cfg.TelegramBotToken)-3:]
			}
			if cfg.BackupPassword != "your_backup_passphrase_here" && len(cfg.BackupPassword) > 3 {
				cfg.BackupPassword = cfg.BackupPassword[:1] + "********" + cfg.BackupPassword[len(cfg.BackupPassword)-1:]
			}
			if cfg.PikPakPass != "" && len(cfg.PikPakPass) > 2 {
				cfg.PikPakPass = "••••••"
			}

			json.NewEncoder(w).Encode(cfg)
			return
		}

		if r.Method == "POST" {
			var newCfg Config
			if err := json.NewDecoder(r.Body).Decode(&newCfg); err != nil {
				http.Error(w, "无效的 JSON 数据", http.StatusBadRequest)
				return
			}

			configMutex.Lock()
			if strings.Contains(newCfg.TelegramBotToken, "*****") || newCfg.TelegramBotToken == "••••••" || (newCfg.TelegramBotToken == "" && currentConfig.TelegramBotToken != "") {
				newCfg.TelegramBotToken = currentConfig.TelegramBotToken
			}
			if strings.Contains(newCfg.BackupPassword, "*****") || newCfg.BackupPassword == "••••••" || (newCfg.BackupPassword == "" && currentConfig.BackupPassword != "") {
				newCfg.BackupPassword = currentConfig.BackupPassword
			}
			if strings.Contains(newCfg.PikPakPass, "*****") || newCfg.PikPakPass == "••••••" || (newCfg.PikPakPass == "" && currentConfig.PikPakPass != "") {
				newCfg.PikPakPass = currentConfig.PikPakPass
			}
			newCfg.DownloadToken = currentConfig.DownloadToken

			err := saveConfigNoLock(newCfg)
			if err != nil {
				configMutex.Unlock()
				http.Error(w, "无法保存配置文件: "+err.Error(), http.StatusInternalServerError)
				return
			}
			currentConfig = newCfg
			configMutex.Unlock()

			// 配置 PikPak 原生远端并自动包装加密
			if newCfg.PikPakUser != "" {
				log.Printf("[RCLONE] 正在配置 PikPak 原生远端...")
				exec.Command("rclone", "config", "create", "pikpak", "pikpak",
					"user", newCfg.PikPakUser,
					"pass", newCfg.PikPakPass,
					"--config", "/config/rclone.conf",
				).Run()

				log.Printf("[RCLONE] 正在为 PikPak 创建 crypt 加密壳...")
				exec.Command("rclone", "config", "create", "pikpak-crypt", "crypt",
					"remote", "pikpak:backup/encrypted",
					"password", newCfg.BackupPassword,
					"--config", "/config/rclone.conf",
				).Run()
			}

			// 配置云盘加密外壳自适应
			autoWrapCloudRemotes(newCfg.BackupPassword)

			restartScheduler()
			triggerLocalPullManifestGFSCleanup()

			json.NewEncoder(w).Encode(map[string]string{"status": "ok", "message": "配置保存成功"})
			return
		}

		http.Error(w, "方法不允许", http.StatusMethodNotAllowed)
	})

	// J. 手动触发即时备份 API (已重构为后台异步排队模式，且具备防重机制)
	mux.HandleFunc("/api/backup/now", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}

		if r.Method == "POST" {
			backupType := r.URL.Query().Get("type")
			if backupType != "db" && backupType != "sys" && backupType != "img" {
				backupType = "db" // 默认数据库热备
			}

			// 防重拦截：检查是否有同类型的活跃备份任务在运行
			activeTasksMutex.Lock()
			isRunning := false
			expectedType := backupType + "_backup"
			for _, t := range activeTasks {
				if t.Type == expectedType && (t.Status == "running" || t.Status == "paused") {
					isRunning = true
					break
				}
			}
			activeTasksMutex.Unlock()

			if isRunning {
				w.WriteHeader(http.StatusConflict)
				json.NewEncoder(w).Encode(map[string]string{
					"status":  "error",
					"message": "已有相同的备份任务正在后台运行中，请勿重复触发！",
				})
				return
			}

			log.Printf("[API] 收到手动触发 %s 类型即时备份指令，已提交至后台协程异步执行...", backupType)
			
			// 后台异步协程执行
			go func() {
				output, err := executeBackup(backupType, true) // isManual = true
				if err != nil {
					log.Printf("[ERROR] 手动 %s 备份执行失败: %v, 日志: %s", backupType, err, output)
				} else {
					log.Printf("[SUCCESS] 手动 %s 备份成功完成，日志: %s", backupType, output)
					runCleanupForPools(backupType)
				}
			}()

			json.NewEncoder(w).Encode(map[string]string{
				"status":  "ok",
				"message": "备份任务已成功在后台启动，请查看上方任务大厅进度！",
			})
			return
		}
		http.Error(w, "方法不允许", http.StatusMethodNotAllowed)
	})

	// K. 托管前端静态 React
	subFS, err := fs.Sub(webResources, "dist")
	if err != nil {
		log.Fatalf("无法定位嵌入资源目录: %v", err)
	}

	fileServer := http.FileServer(http.FS(subFS))
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api") {
			return
		}

		filePath := strings.TrimPrefix(r.URL.Path, "/")
		if filePath == "" {
			filePath = "index.html"
		}

		_, err := subFS.Open(filePath)
		if err != nil {
			r.URL.Path = "/"
		}

		fileServer.ServeHTTP(w, r)
	})

	// 注册第四阶段高可用与分布式标签、配置导入导出 API
	mux.HandleFunc("/api/backups/transfer", handleBackupsTransfer)
	mux.HandleFunc("/api/backups/labels", handleBackupsLabels)
	mux.HandleFunc("/api/settings/export", handleSettingsExport)
	mux.HandleFunc("/api/settings/import", handleSettingsImport)
	mux.HandleFunc("/api/settings/import/confirm", handleSettingsImportConfirm)

	// 新增：任务监控与多池永久留档 API
	mux.HandleFunc("/api/tasks/list", handleTasksList)
	mux.HandleFunc("/api/tasks/control", handleTasksControl)
	mux.HandleFunc("/api/backups/archive", handleBackupsArchive)

	return mux
}

// handleTasksList 处理任务列表获取请求
func handleTasksList(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	if r.Method != "GET" {
		http.Error(w, "方法不允许", http.StatusMethodNotAllowed)
		return
	}
	list := getMergedTaskList()
	json.NewEncoder(w).Encode(list)
}

// handleTasksControl 处理任务挂起、恢复、强杀控制请求
func handleTasksControl(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

	if r.Method == "OPTIONS" {
		w.WriteHeader(http.StatusOK)
		return
	}

	if r.Method != "POST" {
		http.Error(w, "方法不允许", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		TaskID string `json:"task_id"`
		Action string `json:"action"` // "pause", "resume", "kill"
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "无效的 JSON 数据", http.StatusBadRequest)
		return
	}

	activeTasksMutex.Lock()
	cmd, existsCmd := taskCmds[req.TaskID]
	task, existsTask := activeTasks[req.TaskID]
	activeTasksMutex.Unlock()

	if !existsCmd || !existsTask || cmd.Process == nil {
		http.Error(w, "找不到该活跃任务进程", http.StatusNotFound)
		return
	}

	var err error
	msg := ""

	switch req.Action {
	case "pause":
		log.Printf("[TASK] 正在挂起任务 %s (PID %d)...", req.TaskID, cmd.Process.Pid)
		// 19 = SIGSTOP
		err = cmd.Process.Signal(syscall.Signal(19))
		if err == nil {
			activeTasksMutex.Lock()
			task.Status = "paused"
			activeTasksMutex.Unlock()
			saveTaskToHistory(task)
			msg = "任务已成功挂起"
		}
	case "resume":
		log.Printf("[TASK] 正在恢复任务 %s (PID %d)...", req.TaskID, cmd.Process.Pid)
		// 18 = SIGCONT
		err = cmd.Process.Signal(syscall.Signal(18))
		if err == nil {
			activeTasksMutex.Lock()
			task.Status = "running"
			activeTasksMutex.Unlock()
			saveTaskToHistory(task)
			msg = "任务已继续运行"
		}
	case "kill":
		log.Printf("[TASK] 正在强杀任务 %s (PID %d)...", req.TaskID, cmd.Process.Pid)
		activeTasksMutex.Lock()
		task.Status = "killed"
		activeTasksMutex.Unlock()
		err = cmd.Process.Kill()
		if err == nil {
			msg = "任务已强行终止"
		}
	default:
		http.Error(w, "不支持的操作类型", http.StatusBadRequest)
		return
	}

	if err != nil {
		http.Error(w, "进程控制失败: "+err.Error(), http.StatusInternalServerError)
		return
	}

	json.NewEncoder(w).Encode(map[string]string{
		"status":  "ok",
		"message": msg,
	})
}

// handleBackupsArchive 处理文件永久留档和取消永久留档操作
func handleBackupsArchive(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

	if r.Method == "OPTIONS" {
		w.WriteHeader(http.StatusOK)
		return
	}

	if r.Method != "POST" {
		http.Error(w, "方法不允许", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		Source   string `json:"source"`   // "local", "onedrive", "gdrive", "pikpak", "telegram", "local_pull"
		Filename string `json:"filename"` // 支持传入带有或不带 _keep_ 的文件名
		Action   string `json:"action"`   // "keep", "unkeep"
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "无效的 JSON 数据", http.StatusBadRequest)
		return
	}

	if req.Filename == "" {
		http.Error(w, "文件名不能为空", http.StatusBadRequest)
		return
	}

	cleanName := filepath.Base(req.Filename)
	isHourly := strings.HasPrefix(cleanName, "db_hourly_")
	isSys := strings.HasPrefix(cleanName, "system_")

	if !isHourly && !isSys {
		http.Error(w, "不支持的文件类型", http.StatusBadRequest)
		return
	}

	baseNameWithoutKeep := strings.ReplaceAll(cleanName, "_keep_", "")
	targetName := baseNameWithoutKeep
	if req.Action == "keep" {
		if strings.HasSuffix(baseNameWithoutKeep, ".tar.gz.enc") {
			targetName = strings.Replace(baseNameWithoutKeep, ".tar.gz.enc", "_keep_.tar.gz.enc", 1)
		} else if strings.HasSuffix(baseNameWithoutKeep, ".enc") {
			targetName = strings.Replace(baseNameWithoutKeep, ".enc", "_keep_.enc", 1)
		} else {
			targetName = baseNameWithoutKeep + "_keep_"
		}
	}

	if targetName == cleanName {
		json.NewEncoder(w).Encode(map[string]string{"status": "ok", "message": "快照留档状态未变更"})
		return
	}

	getRemoteName := func(poolType string) string {
		activeRemotes := getActiveCloudRemotes()
		for _, r := range activeRemotes {
			rClean := strings.TrimSuffix(r, ":")
			rType := getRemoteType(rClean)
			if rType == poolType {
				return r
			}
		}
		return ""
	}

	log.Printf("[ARCHIVE] 触发永久留档修改: %s -> %s (池: %s, 动作: %s)", cleanName, targetName, req.Source, req.Action)

	// A. 本地存储物理改名
	if req.Source == "local" {
		var oldPath, newPath string
		if isHourly {
			oldPath = filepath.Join("/config/local_backup/hourly_db", cleanName)
			newPath = filepath.Join("/config/local_backup/hourly_db", targetName)
		} else {
			oldPath = filepath.Join("/config/local_backup/system_backup", cleanName)
			newPath = filepath.Join("/config/local_backup/system_backup", targetName)
		}

		if _, err := os.Stat(oldPath); err != nil {
			http.Error(w, "找不到本地物理快照包: "+cleanName, http.StatusNotFound)
			return
		}

		if err := os.Rename(oldPath, newPath); err != nil {
			http.Error(w, "物理改名失败: "+err.Error(), http.StatusInternalServerError)
			return
		}

		updateLocalPullManifestFilename(cleanName, targetName)

	// B. Telegram 逻辑留档
	} else if req.Source == "telegram" {
		exemptionsPath := "/config/telegram_exemptions.json"
		var exemptions []string
		if data, err := os.ReadFile(exemptionsPath); err == nil {
			json.Unmarshal(data, &exemptions)
		}

		exMap := make(map[string]bool)
		for _, name := range exemptions {
			exMap[name] = true
		}

		if req.Action == "keep" {
			exMap[baseNameWithoutKeep] = true
		} else {
			delete(exMap, baseNameWithoutKeep)
		}

		var newExemptions []string
		for name := range exMap {
			newExemptions = append(newExemptions, name)
		}

		os.MkdirAll(filepath.Dir(exemptionsPath), 0755)
		if data, err := json.MarshalIndent(newExemptions, "", "  "); err == nil {
			os.WriteFile(exemptionsPath, data, 0644)
		}

	// C. 本地同步虚拟逻辑清单改名
	} else if req.Source == "local_pull" {
		updateLocalPullManifestFilename(cleanName, targetName)

		var oldPath, newPath string
		if isHourly {
			oldPath = filepath.Join("/config/local_backup/hourly_db", cleanName)
			newPath = filepath.Join("/config/local_backup/hourly_db", targetName)
		} else {
			oldPath = filepath.Join("/config/local_backup/system_backup", cleanName)
			newPath = filepath.Join("/config/local_backup/system_backup", targetName)
		}
		if _, err := os.Stat(oldPath); err == nil {
			os.Rename(oldPath, newPath)
		}

	// D. 云端物理改名 (rclone moveto)
	} else {
		remote := getRemoteName(req.Source)
		if remote == "" {
			http.Error(w, "找不到云存储池配置: "+req.Source, http.StatusNotFound)
			return
		}

		var subDir string
		if isHourly {
			subDir = "backup/hourly_db/"
		} else {
			subDir = "backup/system_backup/"
		}

		oldCloudPath := remote + subDir + cleanName
		newCloudPath := remote + subDir + targetName

		log.Printf("[ARCHIVE] 云端改名中: %s -> %s", oldCloudPath, newCloudPath)
		if _, err := runTrackedCommand("sync", "云端快照重命名 ("+cleanName+")", "rclone", "moveto", oldCloudPath, newCloudPath, "--config", "/config/rclone.conf"); err != nil {
			http.Error(w, "云端改名失败: "+err.Error(), http.StatusInternalServerError)
			return
		}
	}

	json.NewEncoder(w).Encode(map[string]string{
		"status":  "ok",
		"message": "快照永久留档属性已成功更新！",
	})
}

// updateLocalPullManifestFilename 辅助修改虚拟清单中的文件名
func updateLocalPullManifestFilename(oldName, newName string) {
	manifestPath := "/config/local_pull_manifest.json"
	configMutex.Lock()
	defer configMutex.Unlock()

	var items []LocalPullItem
	data, err := os.ReadFile(manifestPath)
	if err == nil {
		json.Unmarshal(data, &items)
	}

	updated := false
	for i := range items {
		if items[i].Name == oldName {
			items[i].Name = newName
			items[i].ModTime = time.Now()
			updated = true
			break
		}
	}

	if updated {
		os.MkdirAll(filepath.Dir(manifestPath), 0755)
		if outData, err := json.MarshalIndent(items, "", "  "); err == nil {
			os.WriteFile(manifestPath, outData, 0644)
			log.Printf("[LOCAL_PULL] 虚拟拉取清单条目改名: %s -> %s", oldName, newName)
		}
	}
}


// ------------------------------------------------------------------------------
// 10. 启动入口
// ------------------------------------------------------------------------------

func main() {
	rotWriter, err := NewSizeRotatingWriter("/config/backup_agent.log", 2*1024*1024)
	if err == nil {
		log.SetOutput(io.MultiWriter(os.Stdout, rotWriter))
	} else {
		log.Printf("[WARN] 无法初始化日志文件双写: %v", err)
	}

	log.Printf("[START] Shield-Backup 灾备控制中心服务正在启动...")

	loadConfig()

	restartScheduler()

	go runCleanupForPools("all")
	go startDailyLabelsSync()

	handler := setupRoutes()
	port := ":9999"
	log.Printf("[HTTP] 可视化 Web 端开始监听端口 %s", port)
	if err := http.ListenAndServe(port, handler); err != nil {
		log.Fatalf("[FATAL] 服务拉起失败: %v", err)
	}
}

// ==============================================================================
// 第四阶段：新版分布式配置、高可用文件传输、以及凌晨标签同步自愈核心代码实现
// ==============================================================================

type SettingsExportData struct {
	Version    string            `json:"version"`
	Settings   map[string]interface{} `json:"settings"`
	RcloneConf string            `json:"rclone_conf,omitempty"`
	Labels     map[string]string `json:"labels,omitempty"`
}

var tempImportedData struct {
	sync.Mutex
	Data  *SettingsExportData
	Time  time.Time
	Key   string
}

func encryptAES(data []byte, passphrase string) ([]byte, error) {
	key := sha256.Sum256([]byte(passphrase))
	block, err := aes.NewCipher(key[:])
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, err
	}
	ciphertext := gcm.Seal(nonce, nonce, data, nil)
	return ciphertext, nil
}

func decryptAES(ciphertext []byte, passphrase string) ([]byte, error) {
	key := sha256.Sum256([]byte(passphrase))
	block, err := aes.NewCipher(key[:])
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	nonceSize := gcm.NonceSize()
	if len(ciphertext) < nonceSize {
		return nil, fmt.Errorf("ciphertext too short")
	}
	nonce, actualCiphertext := ciphertext[:nonceSize], ciphertext[nonceSize:]
	plaintext, err := gcm.Open(nil, nonce, actualCiphertext, nil)
	if err != nil {
		return nil, err
	}
	return plaintext, nil
}

func handleBackupsTransfer(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

	if r.Method == "OPTIONS" {
		w.WriteHeader(http.StatusOK)
		return
	}

	if r.Method != "POST" {
		http.Error(w, "方法不允许", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		SrcPool   string   `json:"src_pool"`   // "local", "onedrive", "gdrive", "pikpak", "telegram"
		DestPool  string   `json:"dest_pool"`
		Filenames []string `json:"filenames"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "无效的 JSON 数据", http.StatusBadRequest)
		return
	}

	if len(req.Filenames) == 0 {
		http.Error(w, "文件名列表不能为空", http.StatusBadRequest)
		return
	}

	configMutex.Lock()
	tgToken := currentConfig.TelegramBotToken
	tgChatID := currentConfig.TelegramChatID
	configMutex.Unlock()

	getRemoteName := func(poolType string) string {
		activeRemotes := getActiveCloudRemotes()
		for _, r := range activeRemotes {
			rClean := strings.TrimSuffix(r, ":")
			rType := getRemoteType(rClean)
			if rType == poolType {
				return r
			}
		}
		return ""
	}

	successCount := 0
	var errMsgs []string

	// 1. 本地 -> 远端 (上传)
	if req.SrcPool == "local" {
		if req.DestPool == "local" {
			http.Error(w, "源存储池和目标存储池不能相同", http.StatusBadRequest)
			return
		}

		var destFiles []FileInfo
		if req.DestPool == "telegram" {
			var records []TelegramRecord
			if data, err := os.ReadFile("/config/telegram_history.json"); err == nil {
				json.Unmarshal(data, &records)
			}
			for _, rec := range records {
				destFiles = append(destFiles, FileInfo{Name: rec.Path, Size: rec.Size})
			}
		} else if req.DestPool == "local_pull" {
			var items []LocalPullItem
			if data, err := os.ReadFile("/config/local_pull_manifest.json"); err == nil {
				json.Unmarshal(data, &items)
			}
			for _, item := range items {
				destFiles = append(destFiles, FileInfo{Name: item.Name, Size: item.Size})
			}
		} else {
			remote := getRemoteName(req.DestPool)
			if remote != "" {
				hFiles, _ := getRcloneFiles(remote + "backup/hourly_db")
				sFiles, _ := getRcloneFiles(remote + "backup/system_backup")
				destFiles = append(hFiles, sFiles...)
			}
		}

		for _, fname := range req.Filenames {
			cleanName := filepath.Base(fname)
			isHourly := strings.HasPrefix(cleanName, "db_hourly_")
			isSys := strings.HasPrefix(cleanName, "system_")

			if !isHourly && !isSys {
				errMsgs = append(errMsgs, fmt.Sprintf("%s: 不支持的文件类型", cleanName))
				continue
			}

			var localPath string
			var subDir string
			if isHourly {
				localPath = filepath.Join("/config/local_backup/hourly_db", cleanName)
				subDir = "backup/hourly_db/"
			} else {
				localPath = filepath.Join("/config/local_backup/system_backup", cleanName)
				subDir = "backup/system_backup/"
			}

			fi, err := os.Stat(localPath)
			if err != nil {
				errMsgs = append(errMsgs, fmt.Sprintf("%s: 本地物理文件不存在", cleanName))
				continue
			}

			if checkFileExistsWithKeep(destFiles, cleanName, fi.Size()) {
				log.Printf("[TRANSFER] 快照 %s 在目标池中已存在，跳过上传去重。", cleanName)
				successCount++
				continue
			}

			// 重命名加上 _keep_ 保证绝对防自动清理
			targetName := cleanName
			if !strings.Contains(targetName, "_keep_") {
				if strings.HasSuffix(targetName, ".tar.gz.enc") {
					targetName = strings.Replace(targetName, ".tar.gz.enc", "_keep_.tar.gz.enc", 1)
				} else if strings.HasSuffix(targetName, ".enc") {
					targetName = strings.Replace(targetName, ".enc", "_keep_.enc", 1)
				} else {
					targetName = targetName + "_keep_"
				}
			}

			if req.DestPool == "telegram" {
				if tgToken == "" || tgChatID == "" {
					errMsgs = append(errMsgs, fmt.Sprintf("%s: Telegram 未配置", cleanName))
					continue
				}
				caption := fmt.Sprintf("🔒 手动转移快照到 Telegram Bot (防自动清理)\n📄 文件名: %s\n💾 大小: %s", targetName, getFileSizeString(localPath))
				msgID, fileID, err := uploadFileToTelegram(localPath, caption)
				if err != nil {
					errMsgs = append(errMsgs, fmt.Sprintf("%s: Telegram 上传失败: %v", cleanName, err))
				} else {
					saveTelegramRecordDirectly(targetName, msgID, fileID, fi.Size())
					updateTelegramRecordFileID(targetName, fileID)
					successCount++
				}
			} else if req.DestPool == "local_pull" {
				var targetLocalPath string
				if isHourly {
					targetLocalPath = filepath.Join("/config/local_backup/hourly_db", targetName)
				} else {
					targetLocalPath = filepath.Join("/config/local_backup/system_backup", targetName)
				}
				if err := copyFile(localPath, targetLocalPath); err != nil {
					errMsgs = append(errMsgs, fmt.Sprintf("%s: 物理复制失败: %v", cleanName, err))
				} else {
					addLocalPullManifestWithoutCleanup(targetName, fi.Size(), time.Now())
					successCount++
				}
			} else {
				remote := getRemoteName(req.DestPool)
				if remote == "" {
					errMsgs = append(errMsgs, fmt.Sprintf("%s: 无法找到云存储池", cleanName))
					continue
				}
				destPath := remote + subDir + targetName
				log.Printf("[TRANSFER] 正在跨池上传: %s -> %s", localPath, destPath)
				if _, err := runTrackedCommand("upload", "跨池快照上传 ("+cleanName+")", "rclone", "copyto", localPath, destPath, "--config", "/config/rclone.conf", "--transfers", "1", "--retries", "5"); err != nil {
					errMsgs = append(errMsgs, fmt.Sprintf("%s: 复制失败: %v", cleanName, err))
				} else {
					successCount++
				}
			}
		}

	// 2. 远端 -> 本地 (拉取)
	} else if req.DestPool == "local" {
		if req.SrcPool == "local" {
			http.Error(w, "源存储池和目标存储池不能相同", http.StatusBadRequest)
			return
		}

		hFiles, _ := readLocalFiles("/config/local_backup/hourly_db")
		sFiles, _ := readLocalFiles("/config/local_backup/system_backup")
		var localFiles []FileInfo
		localFiles = append(localFiles, hFiles...)
		localFiles = append(localFiles, sFiles...)

		for _, fname := range req.Filenames {
			cleanName := filepath.Base(fname)
			isHourly := strings.HasPrefix(cleanName, "db_hourly_")
			isSys := strings.HasPrefix(cleanName, "system_")

			if !isHourly && !isSys {
				errMsgs = append(errMsgs, fmt.Sprintf("%s: 不支持的文件类型", cleanName))
				continue
			}

			targetName := cleanName
			if !strings.Contains(targetName, "_keep_") {
				if strings.HasSuffix(targetName, ".tar.gz.enc") {
					targetName = strings.Replace(targetName, ".tar.gz.enc", "_keep_.tar.gz.enc", 1)
				} else if strings.HasSuffix(targetName, ".enc") {
					targetName = strings.Replace(targetName, ".enc", "_keep_.enc", 1)
				} else {
					targetName = targetName + "_keep_"
				}
			}

			var localDestPath string
			if isHourly {
				localDestPath = filepath.Join("/config/local_backup/hourly_db", targetName)
			} else {
				localDestPath = filepath.Join("/config/local_backup/system_backup", targetName)
			}

			if _, err := os.Stat(localDestPath); err == nil {
				log.Printf("[TRANSFER] 本地已存在快照 %s，跳过拉取去重。", targetName)
				successCount++
				continue
			}

			if req.SrcPool == "telegram" {
				var records []TelegramRecord
				if data, err := os.ReadFile("/config/telegram_history.json"); err == nil {
					json.Unmarshal(data, &records)
				}
				fileID := ""
				for _, rec := range records {
					if rec.Path == cleanName {
						fileID = rec.FileID
						break
					}
				}

				if fileID == "" {
					errMsgs = append(errMsgs, fmt.Sprintf("%s: 未能找到该 Telegram 快照的 FileID", cleanName))
					continue
				}

				log.Printf("[TRANSFER] 正在从 Telegram 拉取快照: %s", localDestPath)
				if err := downloadFileFromTelegram(fileID, localDestPath); err != nil {
					errMsgs = append(errMsgs, fmt.Sprintf("%s: 下载失败: %v", cleanName, err))
				} else {
					successCount++
				}
			} else {
				remote := getRemoteName(req.SrcPool)
				if remote == "" {
					errMsgs = append(errMsgs, fmt.Sprintf("%s: 无法找到云存储池", cleanName))
					continue
				}
				var subDir string
				if isHourly {
					subDir = "backup/hourly_db/"
				} else {
					subDir = "backup/system_backup/"
				}

				srcPath := remote + subDir + cleanName
				log.Printf("[TRANSFER] 正在从云端拉取快照: %s -> %s", srcPath, localDestPath)
				if _, err := runTrackedCommand("download", "拉取云端快照 ("+cleanName+")", "rclone", "copyto", srcPath, localDestPath, "--config", "/config/rclone.conf", "--transfers", "1", "--retries", "5"); err != nil {
					errMsgs = append(errMsgs, fmt.Sprintf("%s: 拉取复制失败: %v", cleanName, err))
				} else {
					successCount++
				}
			}
		}
	} else {
		http.Error(w, "不支持的跨池分发模式", http.StatusBadRequest)
		return
	}

	msg := fmt.Sprintf("跨池数据转移完成！成功传输 %d 个快照，失败 %d 个。", successCount, len(errMsgs))
	if len(errMsgs) > 0 {
		msg += " 错误列表: " + strings.Join(errMsgs, "; ")
	}

	json.NewEncoder(w).Encode(map[string]string{
		"status":  "ok",
		"message": msg,
	})
}

func checkFileExistsWithKeep(destFiles []FileInfo, srcFilename string, srcSize int64) bool {
	srcClean := strings.Replace(srcFilename, "_keep_", "", -1)
	for _, f := range destFiles {
		fClean := strings.Replace(f.Name, "_keep_", "", -1)
		if fClean == srcClean && (srcSize == 0 || f.Size == srcSize) {
			return true
		}
	}
	return false
}

func updateTelegramRecordFileID(filename string, fileID string) {
	historyPath := "/config/telegram_history.json"
	var records []TelegramRecord
	if data, err := os.ReadFile(historyPath); err == nil {
		json.Unmarshal(data, &records)
	}

	updated := false
	for i := range records {
		if records[i].Path == filename {
			records[i].FileID = fileID
			updated = true
			break
		}
	}

	if updated {
		if data, err := json.MarshalIndent(records, "", "  "); err == nil {
			os.WriteFile(historyPath, data, 0644)
		}
	}
}

func downloadFileFromTelegram(fileID string, dstPath string) error {
	configMutex.Lock()
	token := currentConfig.TelegramBotToken
	apiURL := currentConfig.TelegramApiURL
	configMutex.Unlock()

	if token == "" || token == "your_telegram_bot_token_here" {
		return fmt.Errorf("Telegram Bot 未配置")
	}

	if apiURL == "" {
		apiURL = "https://api.telegram.org"
	}
	apiURL = strings.TrimSuffix(apiURL, "/")

	getFileURL := fmt.Sprintf("%s/bot%s/getFile?file_id=%s", apiURL, token, fileID)
	resp, err := http.Get(getFileURL)
	if err != nil {
		return fmt.Errorf("调用 getFile 失败: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("getFile 响应失败 (%d): %s", resp.StatusCode, string(body))
	}

	var fileInfo struct {
		Ok     bool `json:"ok"`
		Result struct {
			FilePath string `json:"file_path"`
		} `json:"result"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&fileInfo); err != nil {
		return fmt.Errorf("解析 getFile 响应失败: %v", err)
	}

	if !fileInfo.Ok || fileInfo.Result.FilePath == "" {
		return fmt.Errorf("Telegram 返回的文件路径为空")
	}

	downloadURL := fmt.Sprintf("%s/file/bot%s/%s", apiURL, token, fileInfo.Result.FilePath)
	log.Printf("[TELEGRAM] 正在通过 API 下载文件: %s ...", downloadURL)

	fileResp, err := http.Get(downloadURL)
	if err != nil {
		return fmt.Errorf("获取文件流失败: %v", err)
	}
	defer fileResp.Body.Close()

	if fileResp.StatusCode != http.StatusOK {
		return fmt.Errorf("下载文件流失败 (状态码 %d)", fileResp.StatusCode)
	}

	os.MkdirAll(filepath.Dir(dstPath), 0755)
	out, err := os.Create(dstPath)
	if err != nil {
		return fmt.Errorf("无法创建本地文件: %v", err)
	}
	defer out.Close()

	_, err = io.Copy(out, fileResp.Body)
	if err != nil {
		return fmt.Errorf("写入文件流失败: %v", err)
	}

	return nil
}

func handleBackupsLabels(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

	if r.Method == "OPTIONS" {
		w.WriteHeader(http.StatusOK)
		return
	}

	localPath := "/config/backup_labels.json"

	type LabelConfig struct {
		Labels map[string]string `json:"labels"`
	}

	if r.Method == "GET" {
		var lConfig LabelConfig
		lConfig.Labels = make(map[string]string)
		if data, err := os.ReadFile(localPath); err == nil {
			json.Unmarshal(data, &lConfig)
		}
		// 自愈清洗：去除旧数据中可能存在的 _keep_ 标识
		cleanedLabels := make(map[string]string)
		for k, v := range lConfig.Labels {
			cleanedKey := strings.ReplaceAll(k, "_keep_", "")
			cleanedLabels[cleanedKey] = v
		}
		lConfig.Labels = cleanedLabels
		json.NewEncoder(w).Encode(lConfig)
		return
	}

	if r.Method == "POST" {
		var req struct {
			Filename string `json:"filename"`
			Label    string `json:"label"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "无效的 JSON 数据", http.StatusBadRequest)
			return
		}

		if req.Filename == "" {
			http.Error(w, "文件名不能为空", http.StatusBadRequest)
			return
		}

		configMutex.Lock()
		defer configMutex.Unlock()

		var lConfig LabelConfig
		lConfig.Labels = make(map[string]string)
		if data, err := os.ReadFile(localPath); err == nil {
			json.Unmarshal(data, &lConfig)
		}

		if lConfig.Labels == nil {
			lConfig.Labels = make(map[string]string)
		}

		cleanFilename := strings.ReplaceAll(req.Filename, "_keep_", "")
		if req.Label == "" {
			delete(lConfig.Labels, cleanFilename)
		} else {
			lConfig.Labels[cleanFilename] = req.Label
		}

		// 广播保存前执行一次全量自愈清洗
		cleanedLabels := make(map[string]string)
		for k, v := range lConfig.Labels {
			cleanedKey := strings.ReplaceAll(k, "_keep_", "")
			cleanedLabels[cleanedKey] = v
		}
		lConfig.Labels = cleanedLabels

		os.MkdirAll(filepath.Dir(localPath), 0755)
		data, err := json.MarshalIndent(lConfig, "", "  ")
		if err != nil {
			http.Error(w, "序列化失败: "+err.Error(), http.StatusInternalServerError)
			return
		}

		if err := os.WriteFile(localPath, data, 0644); err != nil {
			http.Error(w, "保存失败: "+err.Error(), http.StatusInternalServerError)
			return
		}

		json.NewEncoder(w).Encode(map[string]string{"status": "ok", "message": "标签备注修改成功"})
		return
	}

	http.Error(w, "方法不允许", http.StatusMethodNotAllowed)
}

func handleSettingsExport(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

	if r.Method == "OPTIONS" {
		w.WriteHeader(http.StatusOK)
		return
	}

	if r.Method != "GET" {
		http.Error(w, "方法不允许", http.StatusMethodNotAllowed)
		return
	}

	configMutex.Lock()
	pwd := currentConfig.BackupPassword
	configMutex.Unlock()

	settingsMap := make(map[string]interface{})
	if sData, err := os.ReadFile(configPath); err == nil {
		json.Unmarshal(sData, &settingsMap)
	}

	rcloneContent := ""
	if rData, err := os.ReadFile("/config/rclone.conf"); err == nil {
		rcloneContent = string(rData)
	}

	var labelsMap map[string]string
	if lData, err := os.ReadFile("/config/backup_labels.json"); err == nil {
		var lConfig struct {
			Labels map[string]string `json:"labels"`
		}
		if json.Unmarshal(lData, &lConfig) == nil {
			labelsMap = lConfig.Labels
		}
	}

	exportObj := SettingsExportData{
		Version:    "4.0",
		Settings:   settingsMap,
		RcloneConf: rcloneContent,
		Labels:     labelsMap,
	}

	rawJSON, err := json.Marshal(exportObj)
	if err != nil {
		http.Error(w, "配置打包失败: "+err.Error(), http.StatusInternalServerError)
		return
	}

	queryPwd := r.URL.Query().Get("password")
	if queryPwd != "" {
		pwd = queryPwd
	}
	encrypted, err := encryptAES(rawJSON, pwd)
	if err != nil {
		http.Error(w, "加密失败: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Disposition", `attachment; filename="shield_backup_settings.enc"`)
	w.Write(encrypted)
}

func handleSettingsImport(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

	if r.Method == "OPTIONS" {
		w.WriteHeader(http.StatusOK)
		return
	}

	if r.Method != "POST" {
		http.Error(w, "方法不允许", http.StatusMethodNotAllowed)
		return
	}

	r.ParseMultipartForm(10 << 20)
	pwd := r.FormValue("password")
	if pwd == "" {
		http.Error(w, "验证密码不能为空", http.StatusBadRequest)
		return
	}

	file, _, err := r.FormFile("file")
	if err != nil {
		http.Error(w, "无法读取上传的文件", http.StatusBadRequest)
		return
	}
	defer file.Close()

	fileBytes, err := io.ReadAll(file)
	if err != nil {
		http.Error(w, "读取文件流失败", http.StatusInternalServerError)
		return
	}

	decrypted, err := decryptAES(fileBytes, pwd)
	if err != nil {
		http.Error(w, "解密失败，密码不正确或文件已损坏！", http.StatusUnauthorized)
		return
	}

	var importData SettingsExportData
	if err := json.Unmarshal(decrypted, &importData); err != nil {
		http.Error(w, "配置解析失败，可能不是合法的设置备份文件: "+err.Error(), http.StatusBadRequest)
		return
	}

	tempImportedData.Lock()
	tempImportedData.Data = &importData
	tempImportedData.Time = time.Now()
	tempImportedData.Key = pwd
	tempImportedData.Unlock()

	modules := make(map[string]map[string]interface{})

	if len(importData.Settings) > 0 {
		hasTelegramApiURL := false
		if _, exists := importData.Settings["telegram_api_url"]; exists {
			hasTelegramApiURL = true
		}

		modules["settings"] = map[string]interface{}{
			"available":          true,
			"compatible":         hasTelegramApiURL,
			"message":            "Shield-Backup 核心定时与参数配置",
			"has_missing_fields": !hasTelegramApiURL,
		}
	} else {
		modules["settings"] = map[string]interface{}{
			"available": false,
		}
	}

	if importData.RcloneConf != "" {
		modules["rclone"] = map[string]interface{}{
			"available":  true,
			"compatible": true,
			"message":    "云端存储池认证凭证配置 (rclone.conf)",
		}
	} else {
		modules["rclone"] = map[string]interface{}{
			"available": false,
		}
	}

	if len(importData.Labels) > 0 {
		modules["labels"] = map[string]interface{}{
			"available":  true,
			"compatible": true,
			"message":    "快照备注与文件标签缓存",
		}
	} else {
		modules["labels"] = map[string]interface{}{
			"available": false,
		}
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":  "ok",
		"modules": modules,
	})
}

func handleSettingsImportConfirm(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

	if r.Method == "OPTIONS" {
		w.WriteHeader(http.StatusOK)
		return
	}

	if r.Method != "POST" {
		http.Error(w, "方法不允许", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		SelectedModules []string `json:"selected_modules"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "无效的 JSON 数据", http.StatusBadRequest)
		return
	}

	tempImportedData.Lock()
	defer tempImportedData.Unlock()

	if tempImportedData.Data == nil || time.Since(tempImportedData.Time) > 10*time.Minute {
		http.Error(w, "导入会话已过期，请重新上传文件进行解密", http.StatusBadRequest)
		return
	}

	restoredCount := 0

	for _, mod := range req.SelectedModules {
		if mod == "settings" && len(tempImportedData.Data.Settings) > 0 {
			settingsBytes, err := json.Marshal(tempImportedData.Data.Settings)
			if err == nil {
				var importedConfig Config
				if json.Unmarshal(settingsBytes, &importedConfig) == nil {
					if importedConfig.TelegramApiURL == "" {
						importedConfig.TelegramApiURL = "https://api.telegram.org"
					}
					importedConfig.DownloadToken = currentConfig.DownloadToken

					configMutex.Lock()
					saveConfigNoLock(importedConfig)
					currentConfig = importedConfig
					configMutex.Unlock()

					autoWrapCloudRemotes(importedConfig.BackupPassword)
					restartScheduler()
					restoredCount++
				}
			}
		}

		if mod == "rclone" && tempImportedData.Data.RcloneConf != "" {
			if err := os.WriteFile("/config/rclone.conf", []byte(tempImportedData.Data.RcloneConf), 0600); err == nil {
				restoredCount++
			}
		}

		if mod == "labels" && len(tempImportedData.Data.Labels) > 0 {
			type LabelConfig struct {
				Labels map[string]string `json:"labels"`
			}
			lConfig := LabelConfig{Labels: tempImportedData.Data.Labels}
			if data, err := json.MarshalIndent(lConfig, "", "  "); err == nil {
				if os.WriteFile("/config/backup_labels.json", data, 0644) == nil {
					restoredCount++
				}
			}
		}
	}

	tempImportedData.Data = nil

	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":  "ok",
		"message": fmt.Sprintf("成功还原并加载了 %d 个勾选的配置模块！", restoredCount),
	})
}

func startDailyLabelsSync() {
	for {
		now := time.Now()
		next := time.Date(now.Year(), now.Month(), now.Day(), 3, 0, 0, 0, now.Location())
		if now.After(next) {
			next = next.Add(24 * time.Hour)
		}
		time.Sleep(next.Sub(now))

		log.Printf("[SYNC] 触发每日凌晨 3:00 标签配置自愈同步任务...")
		syncLabelsGlobally()
	}
}

func syncLabelsGlobally() {
	localPath := "/config/backup_labels.json"
	activeRemotes := getActiveCloudRemotes()

	type LabelConfig struct {
		Labels map[string]string `json:"labels"`
	}

	localLabels := LabelConfig{Labels: make(map[string]string)}
	if data, err := os.ReadFile(localPath); err == nil {
		json.Unmarshal(data, &localLabels)
	}

	var latestRemoteTime time.Time
	var latestRemotePath string
	var latestRemoteConfig LabelConfig

	for _, remote := range activeRemotes {
		remoteFilePath := remote + "backup/backup_labels.json"
		cmd := exec.Command("rclone", "lsjson", remoteFilePath, "--config", "/config/rclone.conf")
		var out bytes.Buffer
		cmd.Stdout = &out
		if err := cmd.Run(); err == nil {
			var files []FileInfo
			if err := json.Unmarshal(out.Bytes(), &files); err == nil && len(files) > 0 {
				fInfo := files[0]
				if fInfo.ModTime.After(latestRemoteTime) {
					tmpFile := "/tmp/remote_labels.json"
					os.Remove(tmpFile)
					dlCmd := exec.Command("rclone", "copyto", remoteFilePath, tmpFile, "--config", "/config/rclone.conf")
					if dlCmd.Run() == nil {
						var rLabels LabelConfig
						if rData, err := os.ReadFile(tmpFile); err == nil {
							if json.Unmarshal(rData, &rLabels) == nil {
								latestRemoteTime = fInfo.ModTime
								latestRemotePath = remoteFilePath
								latestRemoteConfig = rLabels
							}
						}
						os.Remove(tmpFile)
					}
				}
			}
		}
	}

	merged := false
	if latestRemotePath != "" {
		if len(localLabels.Labels) == 0 {
			localLabels = latestRemoteConfig
			merged = true
			log.Printf("[SYNC] 本地标签为空，已成功拉取最近更新的云端版本: %s", latestRemotePath)
		} else {
			for k, v := range latestRemoteConfig.Labels {
				if _, exists := localLabels.Labels[k]; !exists {
					localLabels.Labels[k] = v
					merged = true
				}
			}
		}
	}

	if merged || len(localLabels.Labels) > 0 {
		// 广播前做一次自愈清洗，剥离所有的 _keep_
		cleanedLabels := make(map[string]string)
		for k, v := range localLabels.Labels {
			cleanedKey := strings.ReplaceAll(k, "_keep_", "")
			cleanedLabels[cleanedKey] = v
		}
		localLabels.Labels = cleanedLabels

		os.MkdirAll(filepath.Dir(localPath), 0755)
		if data, err := json.MarshalIndent(localLabels, "", "  "); err == nil {
			os.WriteFile(localPath, data, 0644)
			log.Printf("[SYNC] 标签数据库合并完成，准备进行全网广播同步...")

			for _, remote := range activeRemotes {
				destPath := remote + "backup/backup_labels.json"
				log.Printf("[SYNC] 广播标签至远端存储池: %s", destPath)
				exec.Command("rclone", "copyto", localPath, destPath, "--config", "/config/rclone.conf").Run()
			}
		}
	}
}

// SizeRotatingWriter 结构体用于实现大小上限为 2MB 的日志轮滚双写文件写入器
type SizeRotatingWriter struct {
	mu       sync.Mutex
	filename string
	maxSize  int64
	file     *os.File
}

// NewSizeRotatingWriter 初始化并创建 SizeRotatingWriter 实例
func NewSizeRotatingWriter(filename string, maxSize int64) (*SizeRotatingWriter, error) {
	w := &SizeRotatingWriter{
		filename: filename,
		maxSize:  maxSize,
	}
	if err := w.rotate(); err != nil {
		return nil, err
	}
	return w, nil
}

// Write 执行写入日志动作，如果超过限制自动轮滚
func (w *SizeRotatingWriter) Write(p []byte) (n int, err error) {
	w.mu.Lock()
	defer w.mu.Unlock()

	if w.file != nil {
		if fi, err := w.file.Stat(); err == nil && fi.Size()+int64(len(p)) > w.maxSize {
			w.file.Close()
			backupName := w.filename + ".1"
			os.Remove(backupName)
			os.Rename(w.filename, backupName)

			w.file, err = os.OpenFile(w.filename, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
			if err != nil {
				return 0, err
			}
		}
	}

	if w.file == nil {
		w.file, err = os.OpenFile(w.filename, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
		if err != nil {
			return 0, err
		}
	}

	return w.file.Write(p)
}

// rotate 对超过大小的日志进行重命名归档与重新打开
func (w *SizeRotatingWriter) rotate() error {
	w.mu.Lock()
	defer w.mu.Unlock()

	os.MkdirAll(filepath.Dir(w.filename), 0755)

	if fi, err := os.Stat(w.filename); err == nil && fi.Size() > w.maxSize {
		backupName := w.filename + ".1"
		os.Remove(backupName)
		os.Rename(w.filename, backupName)
	}

	f, err := os.OpenFile(w.filename, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
	if err != nil {
		return err
	}
	w.file = f
	return nil
}

// handleGetLogs 读取并返回最近 100 行系统运行日志
func handleGetLogs(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	if r.Method != "GET" {
		http.Error(w, "方法不允许", http.StatusMethodNotAllowed)
		return
	}

	data, err := os.ReadFile("/config/backup_agent.log")
	if err != nil {
		json.NewEncoder(w).Encode([]string{"[INFO] 暂无日志记录"})
		return
	}

	lines := strings.Split(string(data), "\n")
	var cleanLines []string
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line != "" {
			cleanLines = append(cleanLines, line)
		}
	}

	start := 0
	if len(cleanLines) > 100 {
		start = len(cleanLines) - 100
	}
	recentLines := cleanLines[start:]

	json.NewEncoder(w).Encode(recentLines)
}

// handleLocalPullManifest 差异对比 API（对齐本地同步客户端的文件）
func handleLocalPullManifest(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

	if r.Method == "OPTIONS" {
		w.WriteHeader(http.StatusOK)
		return
	}

	if r.Method != "POST" {
		http.Error(w, "方法不允许", http.StatusMethodNotAllowed)
		return
	}

	tokenParam := r.URL.Query().Get("token")
	configMutex.Lock()
	validToken := currentConfig.DownloadToken
	configMutex.Unlock()

	if tokenParam == "" || tokenParam != validToken {
		http.Error(w, "未授权的拉取助手请求！", http.StatusUnauthorized)
		return
	}

	var req LocalPullManifestRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "无效的 JSON 数据", http.StatusBadRequest)
		return
	}

	manifestPath := "/config/local_pull_manifest.json"
	var manifestItems []LocalPullItem
	manifestData, err := os.ReadFile(manifestPath)
	if err == nil {
		json.Unmarshal(manifestData, &manifestItems)
	}
	if manifestItems == nil {
		manifestItems = []LocalPullItem{}
	}

	lastLocalPullSyncTime = time.Now()
	log.Printf("[LOCAL_PULL] 收到本地拉取助手同步心跳，上报了 %d 个物理文件", len(req.Files))

	clientFileMap := make(map[string]int64)
	for _, f := range req.Files {
		clientFileMap[f.Name] = f.Size
	}

	var downloads []LocalPullItem
	manifestFileMap := make(map[string]bool)

	// A. 筛选出虚拟清单中存在但客户端没有或大小不对的文件
	for _, mItem := range manifestItems {
		manifestFileMap[mItem.Name] = true
		cSize, exists := clientFileMap[mItem.Name]
		if !exists || cSize != mItem.Size {
			downloads = append(downloads, mItem)
		}
	}

	// B. 筛选出客户端本地有多余备份包但不在虚拟清单中的
	var deletes []string
	for _, cFile := range req.Files {
		name := cFile.Name
		isBackupFile := strings.HasPrefix(name, "db_hourly_") || strings.HasPrefix(name, "system_") || strings.HasPrefix(name, "restore_")
		if isBackupFile {
			if !manifestFileMap[name] {
				deletes = append(deletes, name)
			}
		}
	}

	resp := LocalPullManifestResponse{
		Downloads: downloads,
		Deletes:   deletes,
	}

	json.NewEncoder(w).Encode(resp)
}

// handleSettingsTestConnection 处理云存储池及 Telegram 连接性临时测试
func handleSettingsTestConnection(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

	if r.Method == "OPTIONS" {
		w.WriteHeader(http.StatusOK)
		return
	}

	if r.Method != "POST" {
		http.Error(w, "方法不允许", http.StatusMethodNotAllowed)
		return
	}

	var req TestConnectionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "无效的 JSON 数据", http.StatusBadRequest)
		return
	}

	configMutex.Lock()
	if req.TelegramBotToken == "••••••" || strings.Contains(req.TelegramBotToken, "*****") {
		req.TelegramBotToken = currentConfig.TelegramBotToken
	}
	if req.PikPakPass == "••••••" || strings.Contains(req.PikPakPass, "*****") {
		req.PikPakPass = currentConfig.PikPakPass
	}
	configMutex.Unlock()

	if req.Type == "telegram" {
		if req.TelegramBotToken == "" {
			json.NewEncoder(w).Encode(map[string]interface{}{"status": "error", "message": "Telegram Bot Token 不能为空"})
			return
		}
		if req.TelegramApiURL == "" {
			req.TelegramApiURL = "https://api.telegram.org"
		}
		req.TelegramApiURL = strings.TrimSuffix(req.TelegramApiURL, "/")
		reqURL := fmt.Sprintf("%s/bot%s/getMe", req.TelegramApiURL, req.TelegramBotToken)

		client := http.Client{Timeout: 5 * time.Second}
		resp, err := client.Get(reqURL)
		if err != nil {
			json.NewEncoder(w).Encode(map[string]interface{}{"status": "error", "message": fmt.Sprintf("无法连接至 Telegram API: %v", err)})
			return
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			body, _ := io.ReadAll(resp.Body)
			json.NewEncoder(w).Encode(map[string]interface{}{"status": "error", "message": fmt.Sprintf("Telegram 验证失败 (状态码 %d): %s", resp.StatusCode, string(body))})
			return
		}

		json.NewEncoder(w).Encode(map[string]interface{}{"status": "ok", "message": "Telegram Bot 连接测试成功！"})
		return
	}

	if req.Type == "pikpak" {
		if req.PikPakUser == "" || req.PikPakPass == "" {
			json.NewEncoder(w).Encode(map[string]interface{}{"status": "error", "message": "PikPak 配置参数不完整"})
			return
		}

		os.Remove("/tmp/rclone_test.conf")
		cmd := exec.Command("rclone", "config", "create", "pikpak_test", "pikpak",
			"user", req.PikPakUser,
			"pass", req.PikPakPass,
			"--config", "/tmp/rclone_test.conf",
		)
		if err := cmd.Run(); err != nil {
			json.NewEncoder(w).Encode(map[string]interface{}{"status": "error", "message": fmt.Sprintf("无法创建 PikPak 测试配置: %v", err)})
			return
		}
		defer os.Remove("/tmp/rclone_test.conf")

		cmdTest := exec.Command("rclone", "lsd", "pikpak_test:", "--config", "/tmp/rclone_test.conf")
		var stderr bytes.Buffer
		cmdTest.Stderr = &stderr
		if err := cmdTest.Run(); err != nil {
			json.NewEncoder(w).Encode(map[string]interface{}{"status": "error", "message": fmt.Sprintf("连接测试失败: %s", strings.TrimSpace(stderr.String()))})
			return
		}

		json.NewEncoder(w).Encode(map[string]interface{}{"status": "ok", "message": "PikPak 连接测试成功！"})
		return
	}

	if req.Type == "onedrive" || req.Type == "gdrive" {
		remoteName := ""
		activeRemotes := getActiveCloudRemotes()
		for _, r := range activeRemotes {
			rClean := strings.TrimSuffix(r, ":")
			rType := getRemoteType(rClean)
			if rType == req.Type {
				remoteName = r
				break
			}
		}

		if remoteName == "" {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"status":  "error",
				"message": fmt.Sprintf("未在云服务器上检测到 %s 远程配置。请登录 VPS 运行 'rclone config' 完成首次授权建立。", req.Type),
			})
			return
		}

		cmdTest := exec.Command("rclone", "lsd", remoteName, "--config", "/config/rclone.conf")
		var stderr bytes.Buffer
		cmdTest.Stderr = &stderr
		if err := cmdTest.Run(); err != nil {
			json.NewEncoder(w).Encode(map[string]interface{}{"status": "error", "message": fmt.Sprintf("连接测试失败: %s", strings.TrimSpace(stderr.String()))})
			return
		}

		json.NewEncoder(w).Encode(map[string]interface{}{"status": "ok", "message": fmt.Sprintf("%s 连接测试成功！", req.Type)})
		return
	}

	http.Error(w, "不支持的存储池类型", http.StatusBadRequest)
}

// addLocalPullManifest 将备份快照追加进本地客户端冷备拉取清单，并自适应应用 GFS 保留淘汰
func addLocalPullManifest(filename string, size int64, modTime time.Time) {
	manifestPath := "/config/local_pull_manifest.json"
	configMutex.Lock()
	defer configMutex.Unlock()

	var items []LocalPullItem
	data, err := os.ReadFile(manifestPath)
	if err == nil {
		json.Unmarshal(data, &items)
	}

	found := false
	for i := range items {
		if items[i].Name == filename {
			items[i].Size = size
			items[i].ModTime = modTime
			found = true
			break
		}
	}

	if !found {
		items = append(items, LocalPullItem{
			Name:    filename,
			Size:    size,
			ModTime: modTime,
		})
	}

	items = runGFSOnLocalPullManifest(items)

	os.MkdirAll(filepath.Dir(manifestPath), 0755)
	if outData, err := json.MarshalIndent(items, "", "  "); err == nil {
		os.WriteFile(manifestPath, outData, 0644)
		log.Printf("[LOCAL_PULL] 备份快照 %s 已自动加入本地拉取虚拟清单，并完成 GFS 筛选淘汰", filename)
	}
}

// runGFSOnLocalPullManifest 核心 GFS 淘汰决策逻辑
func runGFSOnLocalPullManifest(items []LocalPullItem) []LocalPullItem {
	dbRuleStr := currentConfig.LocalPullDBRule
	sysRuleStr := currentConfig.LocalPullSysRule

	if dbRuleStr == "" {
		dbRuleStr = "H:24h; D:7d; W:30d; M:180d; Y:forever"
	}
	if sysRuleStr == "" {
		sysRuleStr = "D:7d; W:30d; M:180d; Y:forever"
	}

	var dbItems []FileInfo
	var sysItems []FileInfo
	itemMap := make(map[string]LocalPullItem)

	for _, item := range items {
		itemMap[item.Name] = item
		fi := FileInfo{
			Name:    item.Name,
			Size:    item.Size,
			ModTime: item.ModTime,
		}
		if strings.HasPrefix(item.Name, "db_hourly_") {
			dbItems = append(dbItems, fi)
		} else if strings.HasPrefix(item.Name, "system_") {
			sysItems = append(sysItems, fi)
		}
	}

	dbToDelete := filterGFSFilesByRule(dbItems, dbRuleStr)
	sysToDelete := filterGFSFilesByRule(sysItems, sysRuleStr)

	toDeleteMap := make(map[string]bool)
	for _, name := range dbToDelete {
		toDeleteMap[name] = true
	}
	for _, name := range sysToDelete {
		toDeleteMap[name] = true
	}

	var keptItems []LocalPullItem
	for _, item := range items {
		if toDeleteMap[item.Name] && !strings.Contains(item.Name, "_keep_") && !strings.HasPrefix(item.Name, "restore_") {
			log.Printf("[LOCAL_PULL] 根据冷备 GFS 规则，虚拟清单淘汰条目: %s", item.Name)
			continue
		}
		keptItems = append(keptItems, item)
	}

	return keptItems
}

// triggerLocalPullManifestGFSCleanup 修改配置后手工触发虚拟清单筛选
func triggerLocalPullManifestGFSCleanup() {
	manifestPath := "/config/local_pull_manifest.json"
	configMutex.Lock()
	defer configMutex.Unlock()

	var items []LocalPullItem
	data, err := os.ReadFile(manifestPath)
	if err == nil {
		json.Unmarshal(data, &items)
	}

	if len(items) == 0 {
		return
	}

	items = runGFSOnLocalPullManifest(items)

	os.MkdirAll(filepath.Dir(manifestPath), 0755)
	if outData, err := json.MarshalIndent(items, "", "  "); err == nil {
		os.WriteFile(manifestPath, outData, 0644)
		log.Printf("[LOCAL_PULL] 触发冷备 GFS 规则调整后清单重整，最终保留 %d 条快照条目", len(items))
	}
}

// addLocalPullManifestWithoutCleanup 用于跨池手动转移时不进行 GFS 过滤的直接注册
func addLocalPullManifestWithoutCleanup(filename string, size int64, modTime time.Time) {
	manifestPath := "/config/local_pull_manifest.json"
	configMutex.Lock()
	defer configMutex.Unlock()

	var items []LocalPullItem
	data, err := os.ReadFile(manifestPath)
	if err == nil {
		json.Unmarshal(data, &items)
	}

	found := false
	for i := range items {
		if items[i].Name == filename {
			items[i].Size = size
			items[i].ModTime = modTime
			found = true
			break
		}
	}

	if !found {
		items = append(items, LocalPullItem{
			Name:    filename,
			Size:    size,
			ModTime: modTime,
		})
	}

	os.MkdirAll(filepath.Dir(manifestPath), 0755)
	if outData, err := json.MarshalIndent(items, "", "  "); err == nil {
		os.WriteFile(manifestPath, outData, 0644)
		log.Printf("[LOCAL_PULL] 手动分发快照 %s 成功注册到拉取清单", filename)
	}
}

// removeLocalPullManifest 手动从本地拉取虚拟清单中移出快照包记录
func removeLocalPullManifest(filename string) {
	manifestPath := "/config/local_pull_manifest.json"
	configMutex.Lock()
	defer configMutex.Unlock()

	var items []LocalPullItem
	data, err := os.ReadFile(manifestPath)
	if err == nil {
		json.Unmarshal(data, &items)
	}

	var kept []LocalPullItem
	for _, item := range items {
		if item.Name != filename {
			kept = append(kept, item)
		}
	}

	os.MkdirAll(filepath.Dir(manifestPath), 0755)
	if outData, err := json.MarshalIndent(kept, "", "  "); err == nil {
		os.WriteFile(manifestPath, outData, 0644)
		log.Printf("[LOCAL_PULL] 成功从拉取清单中移出 %s 条目，客户端将同步物理删除该文件", filename)
	}
}

