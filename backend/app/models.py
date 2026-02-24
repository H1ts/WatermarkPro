from pydantic import BaseModel
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


class JobInfo(BaseModel):
    id: str
    status: JobStatus
    progress: int = 0
    filename: Optional[str] = None
    client_name: Optional[str] = None
    watch_url: Optional[str] = None
    error: Optional[str] = None
