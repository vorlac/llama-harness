; case display-022-print
; expect exit=0 stdout="plain\n"
.func main arity=0 locals=0
  PUSH_STR "plain"
  PRINT
  RET
.end
