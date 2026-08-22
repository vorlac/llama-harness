; case display-035-write
; expect exit=0 stdout="no newline"
.func main arity=0 locals=0
  PUSH_STR "no newline"
  WRITE
  RET
.end
