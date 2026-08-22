; case display-031-print
; expect exit=0 stdout="tab\there\n"
.func main arity=0 locals=0
  PUSH_STR "tab\there"
  PRINT
  RET
.end
