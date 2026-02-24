from pydantic import BaseModel, Field
from enum import Enum
from typing import Optional


class JobStatus(str, Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    DONE = "done"
    ERROR = "error"


class ProcessRequest(BaseModel):
    file_id: str
    client_name: str
    wm_x: float = Field(default=50.0, ge=0, le=100)
    wm_y: float = Field(default=50.0, ge=0, le=100)
    wm_opacity: int = Field(default=30, ge=20, le=80)
    wm_font_size: int = Field(default=48, ge=16, le=120)
    logo_id: Optional[str] = None
    logo_scale: int = Field(default=25, ge=10, le=50)


class JobInfo(BaseModel):
    id: str
    status: JobStatus
    progress: int = 0
    filename: Optional[str] = None
    client_name: Optional[str] = None
    watch_url: Optional[str] = None
    error: Optional[str] = None
