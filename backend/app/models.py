from pydantic import BaseModel, Field
from enum import Enum
from typing import Optional


class JobStatus(str, Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    DONE = "done"
    ERROR = "error"


class WatermarkPosition(str, Enum):
    CENTER = "center"
    TOP_LEFT = "top-left"
    TOP_RIGHT = "top-right"
    BOTTOM_LEFT = "bottom-left"
    BOTTOM_RIGHT = "bottom-right"
    DIAGONAL = "diagonal"


class ProcessRequest(BaseModel):
    file_id: str
    client_name: str
    wm_position: WatermarkPosition = WatermarkPosition.CENTER
    wm_opacity: int = Field(default=30, ge=20, le=80)
    wm_font_size: int = Field(default=48, ge=16, le=120)


class JobInfo(BaseModel):
    id: str
    status: JobStatus
    progress: int = 0
    filename: Optional[str] = None
    client_name: Optional[str] = None
    watch_url: Optional[str] = None
    error: Optional[str] = None
