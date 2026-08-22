; case display-034-write
; expect exit=0 stdout="ab1\n"
.func main arity=0 locals=0
  PUSH_STR "a"
  WRITE
  PUSH_STR "b"
  WRITE
  PUSH_INT 1
  WRITE
  PUSH_STR ""
  PRINT
  RET
.end
