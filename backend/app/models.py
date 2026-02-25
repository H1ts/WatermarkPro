from pydantic import BaseModel, Field
from enum import Enum
from typing import Optional, List, Any


class JobStatus(str, Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    DONE = "done"
    ERROR = "error"


class ProcessRequest(BaseModel):
    file_id: str
    client_name: str
    project_id: Optional[str] = None
    parent_job_id: Optional[str] = None
    wm_x: float = Field(default=50.0, ge=0, le=100)
    wm_y: float = Field(default=50.0, ge=0, le=100)
    wm_opacity: int = Field(default=30, ge=20, le=80)
    wm_font_size: int = Field(default=48, ge=16, le=120)
    logo_id: Optional[str] = None
    logo_scale: int = Field(default=25, ge=10, le=50)
    quality: str = Field(default="medium", pattern="^(low|medium|high)$")
    codec: str = Field(default="mp4", pattern="^(mp4|mov)$")


class JobInfo(BaseModel):
    id: str
    status: JobStatus
    progress: int = 0
    filename: Optional[str] = None
    client_name: Optional[str] = None
    watch_url: Optional[str] = None
    share_url: Optional[str] = None
    download_url: Optional[str] = None
    codec: Optional[str] = None
    fps: int = 25
    has_password: bool = False
    version: int = 1
    parent_job_id: Optional[str] = None
    review_status: str = "pending_review"
    error: Optional[str] = None


class VersionInfo(BaseModel):
    job_id: str
    version: int
    filename: Optional[str] = None
    status: JobStatus
    created_at: Optional[str] = None


class CreateProjectRequest(BaseModel):
    name: str = Field(min_length=1, max_length=200)


class ProjectInfo(BaseModel):
    id: str
    name: str
    created_at: str
    job_count: int = 0


class ProjectDetail(BaseModel):
    id: str
    name: str
    created_at: str
    jobs: List[JobInfo] = []


# ── Review status ─────────────────────────────────────────────────────

class UpdateReviewStatusRequest(BaseModel):
    review_status: str = Field(pattern="^(pending_review|approved|needs_revision)$")


# ── Share password ────────────────────────────────────────────────────

class SetPasswordRequest(BaseModel):
    password: Optional[str] = Field(default=None, max_length=200)


class VerifyPasswordRequest(BaseModel):
    password: str = Field(max_length=200)


# ── Comments (review) ─────────────────────────────────────────────────

class CreateCommentRequest(BaseModel):
    job_id: str
    author_name: str = Field(default="Аноним", max_length=100)
    text: str = Field(default="", max_length=2000)
    timecode: float = Field(ge=0)
    drawing: List[Any] = Field(default_factory=list)


class UpdateCommentRequest(BaseModel):
    resolved: Optional[bool] = None
    text: Optional[str] = None


class CommentInfo(BaseModel):
    id: str
    job_id: str
    author_name: str
    text: str
    timecode: float
    drawing: List[Any] = []
    resolved: bool = False
    created_at: str
