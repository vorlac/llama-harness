; case strops-109-bytes
; expect exit=0 stdout="3\n"
.func main arity=0 locals=0
  PUSH_STR "a\x00b"
  LEN
  PRINT
  RET
.end
